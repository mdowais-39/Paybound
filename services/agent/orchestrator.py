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


# Round-trip helpers for the multi-product CHOOSE pause: the orchestrator is
# stateless between HTTP calls, so a still-pending product (Intent) or an
# already-resolved one (Candidate) has to travel to the client and back as a
# plain dict via OrchestratorResult.pending_items/resolved_items.
def _intent_to_dict(intent: Intent) -> dict:
    return {
        "query": intent.query,
        "max_price_paise": intent.max_price_paise,
        "category": intent.category,
    }


def _intent_from_dict(d: dict) -> Intent:
    return Intent(query=d["query"], max_price_paise=d.get("max_price_paise"), category=d.get("category"))


def _candidate_to_dict(c: Candidate) -> dict:
    return {
        "item_id": c.item_id,
        "title": c.title,
        "category": c.category,
        "price_paise": c.price_paise,
        "merchant_id": c.merchant_id,
    }


def _candidate_from_dict(d: dict) -> Candidate:
    return Candidate(
        item_id=d["item_id"],
        title=d["title"],
        category=d["category"],
        price_paise=d["price_paise"],
        merchant_id=d.get("merchant_id"),
    )

_PARSE_SYSTEM = """You parse a shopping request into JSON for a bounded buying agent.
Return ONLY a JSON object with these fields:
  items: an array of 1 or more objects, one per DISTINCT product the request
    names — each object:
      query: string — concise product search terms for that ONE product
      max_price_paise: integer or null — price ceiling in paise (rupees*100)
        stated for that product, if any
      category: string or null — a product category if clear
  ambiguous: boolean — true if the request AS A WHOLE is too vague to shop
    (e.g. "something nice"), even after trying to split it into items
  clarification_question: string or null — if ambiguous, a specific follow-up
    question
Only mark ambiguous when you genuinely cannot pick search terms for ANY product
named. Split into multiple `items` ONLY when the request names genuinely
distinct products — "buy running shoes and a phone case" is 2 items; "a grey
leather sofa" is 1 item (multiple adjectives describing ONE product, not
multiple products). Prices in the request are in rupees; multiply by 100 for
paise.
IMPORTANT: an item's max_price_paise must reflect ONLY a price limit the
Request text itself states for THAT product (e.g. "shoes under 3000" -> that
item's max_price_paise=300000; a limit stated once but clearly meant per-item,
e.g. "two things under 1000 each", applies to each). The context also lists
the account's overall allowed categories and total budget — those are
separate, account-level limits enforced elsewhere; never copy the budget
figure into any item's max_price_paise, and leave it null whenever an item
names a specific product without stating its own price limit."""


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
        parsed_intent: Intent | list[Intent] | None = None,
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

        # 2. Parse the goal (the first LLM call) into one Intent per DISTINCT
        # product named — "buy running shoes and a phone case" parses to 2.
        # Tests may inject either a single Intent (the common case) or a list.
        emit("parsing", "active")
        if parsed_intent is not None:
            items = parsed_intent if isinstance(parsed_intent, list) else [parsed_intent]
        else:
            items = self._parse_items(goal, mandate)
        emit("parsing", "success")

        # 3. Ambiguous → ask, don't guess. `_parse_items` collapses a
        # whole-request ambiguity down to a single ambiguous Intent, so this
        # check is unchanged from the single-product path.
        if len(items) == 1 and items[0].ambiguous:
            question = self.clarification.ask(items[0])
            return OrchestratorResult(state="CLARIFY", message=question, clarification_question=question)

        # 4-6. Resolve each product in order — auto-continuing past any
        # unambiguous match, pausing at the first one that needs a human pick
        # (or fails outright), and gating the assembled cart once every
        # product is resolved.
        return self._resolve_items(session_id, items, mandate, on_stage=on_stage)

    def _resolve_items(
        self,
        session_id: str,
        items: list[Intent],
        mandate: dict,
        resolved: list[Candidate] | None = None,
        on_stage: StageCallback | None = None,
    ) -> OrchestratorResult:
        """Resolve `items` (still-pending products) one at a time, bounded to
        the mandate's allowed category/merchant, accumulating onto `resolved`
        (products from this same multi-product goal already resolved). Used
        both by `run()` (resolved=[]) and by `select()`'s continuation after a
        human picks one of several options for a mid-list product.

        Auto-continues past any product with exactly one match — the agent
        still never guesses among several candidates, it just doesn't need a
        human's help when there's only one real answer. The first product
        that's genuinely ambiguous pauses the WHOLE request at CHOOSE (not
        just that product) via `pending_items`/`resolved_items`, so nothing
        already resolved is lost. A product with NO match aborts the whole
        request cleanly — never a cart with only some of what was asked for.

        A cart is single-merchant (the storefront's own `create_cart`
        constraint, mirroring the kernel's `check_merchant`), so once one
        product resolves, every later product's search is scoped to THAT
        merchant only (same precedent as `find_upsell`'s single-merchant
        filter) — catching an incompatible pick as a clean explained refusal
        *before* a cart is ever built, instead of a raw tool error surfacing
        once every product is already resolved."""
        emit = _stage_emitter(on_stage)
        resolved = list(resolved or [])
        remaining = list(items)
        emit("searching", "active")
        while remaining:
            intent = remaining[0]
            already_merchants = {c.merchant_id for c in resolved if c.merchant_id}
            merchant_scope = list(already_merchants) if already_merchants else mandate.get("allowed_merchants")
            outcome = self.discovery.search(
                intent,
                allowed_categories=mandate.get("allowed_categories"),
                allowed_merchants=merchant_scope,
            )
            candidates = outcome.candidates
            if not candidates:
                emit("searching", "success")
                if already_merchants and outcome.reason == "merchant":
                    q = (
                        f'I found matches for "{intent.query}", but only from a '
                        f"different seller than the other item(s) in this order — "
                        f"a single order can only include products from one "
                        f"seller. Nothing was added to your cart; try that item "
                        f"on its own, or ask for one from the same seller."
                    )
                else:
                    q = self._no_match_message(intent, outcome, mandate)
                    if resolved:
                        q = (
                            f"{q} Nothing was added to your cart — the other item(s) "
                            f"in this request weren't purchased either."
                        )
                return OrchestratorResult(state="CLARIFY", message=q, clarification_question=q)

            if len(candidates) > 1:
                # More than one plausible match for THIS product → the agent
                # does not get to guess which brand/price/style the human
                # wants. Offer them, don't silently buy the top-ranked one —
                # same principle as the single-product path, just paused
                # mid-list instead of at the start.
                emit("searching", "success")
                options = candidates[:MAX_OPTIONS]
                total = len(resolved) + len(remaining)
                prefix = f"Item {len(resolved) + 1} of {total}: " if total > 1 else ""
                return OrchestratorResult(
                    state="CHOOSE",
                    message=f'{prefix}I found {len(options)} options for "{intent.query}" — which would you like?',
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
                    pending_items=[_intent_to_dict(i) for i in remaining[1:]] or None,
                    resolved_items=[_candidate_to_dict(c) for c in resolved] or None,
                )

            # Exactly one match for this product — no ambiguity, nothing for
            # a human to decide, so it auto-resolves and the loop moves on to
            # the next product (if any).
            resolved.append(candidates[0])
            remaining = remaining[1:]
        emit("searching", "success")

        if len(resolved) == 1:
            # The single-product path — identical to the pre-multi-product
            # behavior (confidence gate + upsell both still apply).
            return self._compose_and_checkout(session_id, resolved[0], items[0], mandate, on_stage=on_stage)
        return self._compose_and_checkout_many(session_id, resolved, on_stage=on_stage)

    def select(
        self,
        session_id: str,
        item_id: str,
        pending_items: list[dict] | None = None,
        resolved_items: list[dict] | None = None,
        on_stage: StageCallback | None = None,
    ) -> OrchestratorResult:
        """Resume a CHOOSE session after the human picked a specific item
        (POST /sessions/{id}/select). Re-validates the item against the
        mandate's own bounds (category/merchant) here, rather than trusting
        that it was one of the options actually shown — the kernel still
        re-checks price/budget/cap at checkout either way, but this catches a
        mismatched pick before ever building a cart. No LLM call: a human
        explicitly naming the exact item is a stronger signal than any
        confidence score, so it skips that gate too.

        `pending_items`/`resolved_items` are only present for a MULTI-product
        goal — the exact values this same CHOOSE result handed the client,
        echoed straight back (the orchestrator has no memory of its own
        between HTTP calls). When `pending_items` still has entries, this
        pick just resolves ONE of several products and the flow continues to
        the next one instead of checking out; when it's the last product,
        every resolved item composes into ONE cart together."""
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

        if pending_items:
            remaining = [_intent_from_dict(d) for d in pending_items]
            resolved = [_candidate_from_dict(d) for d in (resolved_items or [])] + [candidate]
            return self._resolve_items(session_id, remaining, mandate, resolved=resolved, on_stage=on_stage)
        if resolved_items:
            # The last product of a multi-product goal — everything resolved
            # across this whole exchange goes into one cart together.
            resolved = [_candidate_from_dict(d) for d in resolved_items] + [candidate]
            return self._compose_and_checkout_many(session_id, resolved, on_stage=on_stage)

        # The ordinary single-product path — unchanged.
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
                    # Same "customers often pair X with Y" phrasing as the
                    # campaign orchestrator's nudges (services/campaign/engine.py)
                    # — a suggestion with no stated reason reads as an upsell
                    # push, not a genuine recommendation.
                    message=(
                        f"You're getting {candidate.title}. Customers often pair it with "
                        f"{addon.get('title', 'this item')} "
                        f"({self._rupees(addon['price_paise'])}) — want to add it too? "
                        f"It's optional, your call."
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

    def _compose_and_checkout_many(
        self, session_id: str, items: list[Candidate], on_stage: StageCallback | None = None
    ) -> OrchestratorResult:
        """Compose + gate a cart from MULTIPLE independently-resolved products
        (the multi-product path — see `_resolve_items`). No confidence gate
        and no upsell offer here: every item already passed discovery on its
        own (auto-resolved on an unambiguous match, or explicitly human-picked
        via CHOOSE), which is already a stronger signal than a heuristic
        confidence score — the same reasoning `select()` already uses via
        `skip_confidence_gate` for a single explicit pick. Offering an upsell
        would also mean guessing which ONE of several items to pair it with.

        `_resolve_items` already scopes every search to the merchant of
        whatever's resolved so far, so this shouldn't normally see a mismatch
        — but a human can round-trip stale CHOOSE options from before a
        backend change, so this re-checks before ever calling `create_cart`,
        turning what would otherwise be a raw tool error into the same clean
        explained refusal `_resolve_items` gives when it catches this itself."""
        emit = _stage_emitter(on_stage)
        merchants = {c.merchant_id for c in items if c.merchant_id}
        if len(merchants) > 1:
            names = ", ".join(f'"{c.title}"' for c in items)
            q = (
                f"{names} are from different sellers — a single order can only "
                f"include products from one seller. Nothing was added to your "
                f"cart; ask for them one at a time instead."
            )
            return OrchestratorResult(state="CLARIFY", message=q, clarification_question=q)
        emit("composing", "active")
        cart = self.cart_composer.compose_many(session_id, items)
        emit("composing", "success")
        cart_view = {
            "cart_id": cart.cart_id,
            "total_paise": cart.total_paise,
            "line_items": cart.display_items,
        }
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

    def _parse_items(self, goal: str, mandate: dict) -> list[Intent]:
        """Parse the goal into one Intent per DISTINCT product named. A
        whole-request ambiguity collapses to a single ambiguous Intent
        (ignoring whatever items the LLM may have guessed at) so `run()`'s
        existing single-Intent CLARIFY check keeps working unchanged."""
        cats = mandate.get("allowed_categories") or []
        user = f"Allowed categories: {cats}. Budget (paise): {mandate.get('budget_total_paise')}.\nRequest: {goal}"
        try:
            data = self.llm.complete_json(_PARSE_SYSTEM, user)
        except Exception as e:  # noqa: BLE001
            # Graceful degradation: if the LLM is unavailable (outage / rate
            # limit), fall back to a deterministic single-product parse. The
            # kernel and the mandate bounds still gate everything, so this
            # stays safe — it just can't split a multi-product goal.
            logger.warning("llm_parse_failed_using_heuristic", extra={"error": str(e)})
            return [self._heuristic_intent(goal)]

        if bool(data.get("ambiguous", False)):
            return [
                Intent(
                    query=goal,
                    ambiguous=True,
                    clarification_question=data.get("clarification_question"),
                )
            ]
        raw_items = data.get("items") or []
        if not raw_items:
            # Malformed/empty response — ask rather than silently doing
            # nothing with an unparseable goal.
            return [
                Intent(
                    query=goal,
                    ambiguous=True,
                    clarification_question="Could you say more specifically what you'd like to buy?",
                )
            ]
        return [
            Intent(
                query=str(it.get("query") or goal),
                max_price_paise=it.get("max_price_paise"),
                category=it.get("category"),
            )
            for it in raw_items
        ]

    @staticmethod
    def _heuristic_intent(goal: str) -> Intent:
        import re

        m = re.search(r"(?:under|below|less than)\s*(?:rs\.?|₹)?\s*(\d[\d,]*)", goal, re.IGNORECASE)
        max_price = int(m.group(1).replace(",", "")) * 100 if m else None
        query = re.sub(r"\b(buy|purchase|get|me|please|a|an|the|for)\b", " ", goal, flags=re.IGNORECASE)
        query = re.sub(r"(?:under|below|less than).*$", "", query, flags=re.IGNORECASE).strip()
        return Intent(query=query or goal, max_price_paise=max_price)
