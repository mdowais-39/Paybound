"""Orchestrator Agent — owns the Purchase Session flow and is the ONLY component
permitted to call `checkout`. It runs the deterministic pre-checks BEFORE any
LLM call, parses the goal, delegates to workers (which return typed objects, not
free text), and advances state only on those typed returns.

The whole pipeline narrows authority at each layer: workers propose, the
orchestrator composes and is the sole gate to checkout, and the Rust kernel is
still the final deterministic gate on money — 'agent proposes, kernel disposes',
applied twice."""

from __future__ import annotations

import logging
from collections.abc import Callable

from .base_agent import BaseAgent
from .db import Db
from .llm import LLM
from .models import Candidate, Intent, OrchestratorResult, SearchOutcome
from .precheck import run_prechecks
from .workers.cart_composer import CartComposer
from .workers.clarification import ClarificationWorker
from .workers.discovery import DiscoveryWorker

logger = logging.getLogger("paybound.agent")

CONFIDENCE_THRESHOLD = 0.5
#: How many candidates to offer a human when more than one plausible match
#: exists. The agent does not get to guess a customer's brand/colour/price
#: preference among genuinely distinct options — it proposes, the human picks.
MAX_OPTIONS = 5

#: A stage-progress sink. Called with (stage_id, status) as each REAL pipeline
#: step starts and finishes, so the SSE endpoint can stream genuine progress
#: (not a timed animation). stage_id ∈ pre_checks|parsing|searching|composing|
#: kernel_gate|outcome; status ∈ active|success|refused|needs_human.
StageCallback = Callable[[str, str], None]


def _stage_emitter(on_stage: StageCallback | None) -> StageCallback:
    if on_stage is None:
        return lambda _id, _status: None
    return on_stage

_PARSE_SYSTEM = """You parse a shopping request into JSON for a bounded buying agent.
Return ONLY a JSON object with these fields:
  query: string — concise product search terms
  max_price_paise: integer or null — price ceiling in paise (rupees*100) if stated
  category: string or null — a product category if clear
  ambiguous: boolean — true if the request is too vague to shop (e.g. "something nice")
  clarification_question: string or null — if ambiguous, a specific follow-up question
Only mark ambiguous when you genuinely cannot pick search terms. Prices in the
request are in rupees; multiply by 100 for paise.
IMPORTANT: max_price_paise must reflect ONLY a price limit the Request text itself
states (e.g. "under 3000", "below ₹500"). The context also lists the account's
overall allowed categories and total budget — those are separate, account-level
limits enforced elsewhere; never copy the budget figure into max_price_paise, and
leave it null whenever the request names a specific item without stating its own
price limit."""


class Orchestrator(BaseAgent):
    #: The orchestrator — and only the orchestrator — may call checkout.
    allow_checkout = True

    def __init__(
        self,
        mcp,
        llm: LLM,
        db: Db,
        request_budget: int = 12,
        relevance=None,
        upsell=None,
        confidence=None,
    ):
        super().__init__(mcp, name="orchestrator", request_budget=request_budget)
        self.llm = llm
        self.db = db
        # Share ONE MiniLM embedder across the pipeline: the relevance ranker
        # owns it (loads it lazily), and the upsell model reuses it so its
        # semantic complement lookup matches search's embedding space exactly —
        # and we never load MiniLM twice.
        if upsell is not None and relevance is not None:
            try:
                upsell.set_embedder(relevance.embedder)
            except Exception:  # noqa: BLE001
                pass  # upsell still works via exact-match table + keyword search
        self.discovery = DiscoveryWorker(mcp, request_budget, relevance=relevance)
        self.cart_composer = CartComposer(
            mcp, request_budget, upsell=upsell, confidence=confidence, relevance=relevance
        )
        self.clarification = ClarificationWorker(mcp, request_budget)

    def run(
        self,
        session_id: str,
        goal: str,
        parsed_intent: Intent | None = None,
        on_stage: StageCallback | None = None,
    ) -> OrchestratorResult:
        # `emit` streams genuine pipeline-stage events to the caller (the SSE
        # endpoint) as each real step starts/finishes. Defaults to a no-op, so
        # the plain /run path and the tests are unaffected.
        emit = _stage_emitter(on_stage)

        # 1. Pre-hand checks — deterministic, BEFORE any LLM call.
        emit("pre_checks", "active")
        mandate = self.db.get_mandate_for_session(session_id)
        pre = run_prechecks(mandate, goal, self.request_count)
        if not pre.ok:
            logger.info("pre_check_failed", extra={"reason": pre.reason})
            emit("pre_checks", "refused")
            return OrchestratorResult(
                state="PRE_CHECK_FAILED",
                message=f"Request rejected before reasoning: {pre.reason}.",
                rule_cited=pre.reason,
            )
        emit("pre_checks", "success")

        # 2. Parse the goal (the first LLM call). Tests may inject the intent.
        emit("parsing", "active")
        intent = parsed_intent if parsed_intent is not None else self._parse_intent(goal, mandate)
        emit("parsing", "success")

        # 3. Ambiguous → ask, don't guess.
        if intent.ambiguous:
            question = self.clarification.ask(intent)
            return OrchestratorResult(state="CLARIFY", message=question, clarification_question=question)

        # 4. Shop — bounded to the mandate's allowed category + merchant.
        emit("searching", "active")
        outcome = self.discovery.search(
            intent,
            allowed_categories=mandate.get("allowed_categories"),
            allowed_merchants=mandate.get("allowed_merchants"),
        )
        candidates = outcome.candidates
        if not candidates:
            emit("searching", "success")
            q = self._no_match_message(intent, outcome, mandate)
            return OrchestratorResult(state="CLARIFY", message=q, clarification_question=q)
        emit("searching", "success")

        # 5. More than one plausible match → the agent does not get to guess
        # which brand/price/style the human actually wants. Offer them, don't
        # silently buy the top-ranked one.
        if len(candidates) > 1:
            options = candidates[:MAX_OPTIONS]
            return OrchestratorResult(
                state="CHOOSE",
                message=f"I found {len(options)} options — which would you like?",
                options=[
                    {
                        "item_id": c.item_id,
                        "title": c.title,
                        "category": c.category,
                        "price_paise": c.price_paise,
                        "merchant_id": c.merchant_id,
                    }
                    for c in options
                ],
            )

        # 6. Exactly one match — compose and gate it.
        return self._compose_and_checkout(session_id, candidates[0], intent, mandate, on_stage=on_stage)

    def select(
        self, session_id: str, item_id: str, on_stage: StageCallback | None = None
    ) -> OrchestratorResult:
        """Resume a CHOOSE session after the human picked a specific item
        (POST /sessions/{id}/select). Re-validates the item against the
        mandate's own bounds (category/merchant) here, rather than trusting
        that it was one of the options actually shown — the kernel still
        re-checks price/budget/cap at checkout either way, but this catches a
        mismatched pick before ever building a cart. No LLM call: a human
        explicitly naming the exact item is a stronger signal than any
        confidence score, so it skips that gate too."""
        emit = _stage_emitter(on_stage)
        # The human already did the searching/choosing, so those stages are
        # done the moment we resume.
        for done in ("pre_checks", "parsing", "searching"):
            emit(done, "success")
        mandate = self.db.get_mandate_for_session(session_id)
        item = self.call_tool("get_availability", {"item_id": item_id})

        allowed_categories = mandate.get("allowed_categories") or []
        allowed_merchants = mandate.get("allowed_merchants") or []
        if allowed_categories and item["category"] not in allowed_categories:
            emit("kernel_gate", "refused")
            return OrchestratorResult(
                state="REFUSED",
                message=f"'{item['title']}' is outside the categories this mandate allows.",
                rule_cited="category_not_allowed",
            )
        if allowed_merchants and item["merchant_id"] not in allowed_merchants:
            emit("kernel_gate", "refused")
            return OrchestratorResult(
                state="REFUSED",
                message=f"'{item['title']}' is from a merchant this mandate doesn't allow.",
                rule_cited="merchant_not_allowed",
            )

        candidate = Candidate(
            item_id=item["item_id"],
            title=item["title"],
            category=item["category"],
            price_paise=item["price_paise"],
            merchant_id=item["merchant_id"],
        )
        intent = Intent(query=item["title"], category=item["category"])
        return self._compose_and_checkout(
            session_id, candidate, intent, mandate, skip_confidence_gate=True, on_stage=on_stage
        )

    def _compose_and_checkout(
        self,
        session_id: str,
        candidate: Candidate,
        intent: Intent,
        mandate: dict,
        skip_confidence_gate: bool = False,
        on_stage: StageCallback | None = None,
        addon_item_id: str | None = None,
        upsell_resolved: bool = False,
    ) -> OrchestratorResult:
        emit = _stage_emitter(on_stage)
        # Compose the cart (chosen item, + the accepted addon if the human
        # already decided one), bounded to allowed categories for the upsell
        # proposal below.
        emit("composing", "active")
        cart = self.cart_composer.compose(
            session_id, candidate, intent, addon_item_id=addon_item_id
        )
        emit("composing", "success")

        # A display cart (real titles/prices) attached to every outcome from
        # here on, so the UI can show what was composed without fabricating.
        cart_view = {
            "cart_id": cart.cart_id,
            "total_paise": cart.total_paise,
            "line_items": cart.display_items,
        }

        # Low confidence → route to human (same first-class path as AFA) —
        # skipped when a human already explicitly picked this exact item.
        if not skip_confidence_gate and cart.confidence < CONFIDENCE_THRESHOLD:
            emit("kernel_gate", "needs_human")
            return OrchestratorResult(
                state="NEEDS_HUMAN",
                message="I'm not confident this matches your intent — please confirm.",
                rule_cited="low_confidence",
                cart_id=cart.cart_id,
                amount_paise=cart.total_paise,
                cart=cart_view,
            )

        # A real, in-stock complement exists and the human hasn't weighed in
        # yet (this is the first pass, not a resume of POST .../upsell) —
        # pause and let them accept or decline it before anything is charged.
        # The agent never adds it on its own; see cart_composer.find_upsell.
        if not upsell_resolved:
            addon = self.cart_composer.find_upsell(
                candidate, mandate.get("allowed_categories"), intent
            )
            if addon is not None:
                return OrchestratorResult(
                    state="UPSELL",
                    message=(
                        f"Want to add {addon.get('title', 'this item')} "
                        f"({self._rupees(addon['price_paise'])}) too? It's optional — "
                        f"your call."
                    ),
                    cart_id=cart.cart_id,
                    amount_paise=cart.total_paise,
                    cart=cart_view,
                    upsell_suggestion={
                        "item_id": addon["item_id"],
                        "title": addon.get("title", ""),
                        "category": addon["category"],
                        "price_paise": addon["price_paise"],
                    },
                )

        # Gate: the orchestrator (only) submits the cart to the kernel.
        result = self._checkout(session_id, cart.cart_id, afa_approved=False, on_stage=on_stage)
        result.amount_paise = cart.total_paise
        result.cart = cart_view
        return result

    def resolve_upsell(
        self,
        session_id: str,
        item_id: str,
        accept: bool,
        addon_item_id: str | None = None,
        cart_id: str | None = None,
        on_stage: StageCallback | None = None,
    ) -> OrchestratorResult:
        """Resume an UPSELL-paused session after the human accepted or
        declined the suggested complement (POST /sessions/{id}/upsell).
        `item_id` is the originally chosen item; `addon_item_id` is required
        only when accepting — the exact item_id already shown in
        `upsell_suggestion`, never re-searched. No LLM call, and the
        confidence gate is skipped: it already passed before this suggestion
        was ever shown.

        `cart_id` is the ALREADY-COMPOSED base cart from the initial pause
        (that UPSELL result's own `cart_id`). On DECLINE, nothing about that
        cart changed — its contents are exactly what should be checked out —
        so it's checked out as-is instead of being rebuilt from scratch.
        Rebuilding it would create a second `cart_built` audit entry
        identical to the first, which reads as a confusing duplicate rather
        than a real second cart. On ACCEPT the cart genuinely differs (it now
        includes the addon), so it's composed fresh either way."""
        emit = _stage_emitter(on_stage)
        for done in ("pre_checks", "parsing", "searching"):
            emit(done, "success")

        if not accept and cart_id:
            emit("composing", "active")
            item = self.call_tool("get_availability", {"item_id": item_id})
            cart_view = {
                "cart_id": cart_id,
                "total_paise": item["price_paise"],
                "line_items": [
                    {
                        "item_id": item["item_id"],
                        "title": item["title"],
                        "qty": 1,
                        "price_paise": item["price_paise"],
                        "category": item["category"],
                        "is_upsell": False,
                    }
                ],
            }
            emit("composing", "success")
            result = self._checkout(session_id, cart_id, afa_approved=False, on_stage=on_stage)
            result.amount_paise = item["price_paise"]
            result.cart = cart_view
            return result

        mandate = self.db.get_mandate_for_session(session_id)
        item = self.call_tool("get_availability", {"item_id": item_id})
        candidate = Candidate(
            item_id=item["item_id"],
            title=item["title"],
            category=item["category"],
            price_paise=item["price_paise"],
            merchant_id=item["merchant_id"],
        )
        intent = Intent(query=item["title"], category=item["category"])
        return self._compose_and_checkout(
            session_id,
            candidate,
            intent,
            mandate,
            skip_confidence_gate=True,
            on_stage=on_stage,
            addon_item_id=addon_item_id if accept else None,
            upsell_resolved=True,
        )

    def approve(
        self, session_id: str, cart_id: str, on_stage: StageCallback | None = None
    ) -> OrchestratorResult:
        """Resume a NEEDS_HUMAN session after the human's PIN-equivalent approval
        (clears the ₹15,000 AFA gate; all other bounds still enforced)."""
        emit = _stage_emitter(on_stage)
        for done in ("pre_checks", "parsing", "searching", "composing"):
            emit(done, "success")
        return self._checkout(session_id, cart_id, afa_approved=True, on_stage=on_stage)

    def _checkout(
        self,
        session_id: str,
        cart_id: str,
        afa_approved: bool,
        on_stage: StageCallback | None = None,
    ) -> OrchestratorResult:
        emit = _stage_emitter(on_stage)
        emit("kernel_gate", "active")
        res = self.call_tool(
            "checkout",
            {"session_id": session_id, "cart_id": cart_id, "afa_approved": afa_approved},
        )
        verdict = res["verdict"]
        if verdict == "approved":
            emit("kernel_gate", "success")
            emit("outcome", "success")
            return OrchestratorResult(
                state="AUTHORIZED",
                message=f"Approved. Complete payment: {res.get('payment_link')}",
                verdict=verdict,
                payment_link=res.get("payment_link"),
                cart_id=cart_id,
            )
        if verdict == "needs_human":
            emit("kernel_gate", "needs_human")
            return OrchestratorResult(
                state="NEEDS_HUMAN",
                message=res.get("human_message") or "This purchase needs your approval.",
                verdict=verdict,
                rule_cited=res.get("rule_cited"),
                cart_id=cart_id,
            )
        emit("kernel_gate", "refused")
        return OrchestratorResult(
            state="REFUSED",
            message=res.get("human_message") or "This purchase was declined.",
            verdict=verdict,
            rule_cited=res.get("rule_cited"),
            cart_id=cart_id,
        )

    @staticmethod
    def _rupees(paise: int | None) -> str:
        return f"₹{(paise or 0) // 100:,}"

    def _no_match_message(self, intent: Intent, outcome: SearchOutcome, mandate: dict) -> str:
        """Turn 'search came up empty' into a specific, actionable sentence so
        the customer understands *why* — a genuine no-match, a price ceiling, or
        a mandate restriction — rather than a vague 'couldn't find anything'."""
        q = intent.query
        reason = outcome.reason
        if reason == "price":
            cap = self._rupees(outcome.detail.get("cap_paise"))
            cheapest = self._rupees(outcome.detail.get("cheapest_paise"))
            return (
                f'I found matches for "{q}", but they all cost more than {cap} — '
                f"the cheapest is {cheapest}. Raise the price limit (or the mandate's "
                f"per-item cap) to include it."
            )
        if reason == "category":
            allowed = mandate.get("allowed_categories") or []
            matched = outcome.detail.get("matched") or []
            allowed_str = ", ".join(allowed[:6]) if allowed else "none"
            matched_str = ", ".join(matched) if matched else "other categories"
            return (
                f'"{q}" matches products in categories this mandate doesn\'t cover '
                f"({matched_str}). This mandate is limited to: {allowed_str}. "
                f"Create a mandate without a category restriction to shop the whole catalog."
            )
        if reason == "merchant":
            return (
                f'"{q}" matches products, but only from merchants this mandate '
                f"doesn't allow. Create a mandate for the whole marketplace (no specific "
                f"merchant) to include them."
            )
        # no_match (or unknown): genuinely nothing resembles the query.
        return (
            f'I couldn\'t find anything matching "{q}" in the catalog. '
            f"Try a different product or a broader term."
        )

    def _parse_intent(self, goal: str, mandate: dict) -> Intent:
        cats = mandate.get("allowed_categories") or []
        user = f"Allowed categories: {cats}. Budget (paise): {mandate.get('budget_total_paise')}.\nRequest: {goal}"
        try:
            data = self.llm.complete_json(_PARSE_SYSTEM, user)
        except Exception as e:  # noqa: BLE001
            # Graceful degradation: if the LLM is unavailable (outage / rate
            # limit), fall back to a deterministic parse. The kernel and the
            # mandate bounds still gate everything, so this stays safe.
            logger.warning("llm_parse_failed_using_heuristic", extra={"error": str(e)})
            return self._heuristic_intent(goal)
        return Intent(
            query=str(data.get("query") or goal),
            max_price_paise=data.get("max_price_paise"),
            category=data.get("category"),
            ambiguous=bool(data.get("ambiguous", False)),
            clarification_question=data.get("clarification_question"),
        )

    @staticmethod
    def _heuristic_intent(goal: str) -> Intent:
        import re

        m = re.search(r"(?:under|below|less than)\s*(?:rs\.?|₹)?\s*(\d[\d,]*)", goal, re.IGNORECASE)
        max_price = int(m.group(1).replace(",", "")) * 100 if m else None
        query = re.sub(r"\b(buy|purchase|get|me|please|a|an|the|for)\b", " ", goal, flags=re.IGNORECASE)
        query = re.sub(r"(?:under|below|less than).*$", "", query, flags=re.IGNORECASE).strip()
        return Intent(query=query or goal, max_price_paise=max_price)
