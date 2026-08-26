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

from .base_agent import BaseAgent
from .db import Db
from .llm import LLM
from .models import Candidate, Intent, OrchestratorResult
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
        self.discovery = DiscoveryWorker(mcp, request_budget, relevance=relevance)
        self.cart_composer = CartComposer(mcp, request_budget, upsell=upsell, confidence=confidence)
        self.clarification = ClarificationWorker(mcp, request_budget)

    def run(
        self,
        session_id: str,
        goal: str,
        parsed_intent: Intent | None = None,
    ) -> OrchestratorResult:
        # 1. Pre-hand checks — deterministic, BEFORE any LLM call.
        mandate = self.db.get_mandate_for_session(session_id)
        pre = run_prechecks(mandate, goal, self.request_count)
        if not pre.ok:
            logger.info("pre_check_failed", extra={"reason": pre.reason})
            return OrchestratorResult(
                state="PRE_CHECK_FAILED",
                message=f"Request rejected before reasoning: {pre.reason}.",
                rule_cited=pre.reason,
            )

        # 2. Parse the goal (the first LLM call). Tests may inject the intent.
        intent = parsed_intent if parsed_intent is not None else self._parse_intent(goal, mandate)

        # 3. Ambiguous → ask, don't guess.
        if intent.ambiguous:
            question = self.clarification.ask(intent)
            return OrchestratorResult(state="CLARIFY", message=question, clarification_question=question)

        # 4. Shop — bounded to the mandate's allowed category + merchant.
        candidates = self.discovery.search(
            intent,
            allowed_categories=mandate.get("allowed_categories"),
            allowed_merchants=mandate.get("allowed_merchants"),
        )
        if not candidates:
            q = "I couldn't find items matching that within your limits — want to adjust the budget or category?"
            return OrchestratorResult(state="CLARIFY", message=q, clarification_question=q)

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
        return self._compose_and_checkout(session_id, candidates[0], intent, mandate)

    def select(self, session_id: str, item_id: str) -> OrchestratorResult:
        """Resume a CHOOSE session after the human picked a specific item
        (POST /sessions/{id}/select). Re-validates the item against the
        mandate's own bounds (category/merchant) here, rather than trusting
        that it was one of the options actually shown — the kernel still
        re-checks price/budget/cap at checkout either way, but this catches a
        mismatched pick before ever building a cart. No LLM call: a human
        explicitly naming the exact item is a stronger signal than any
        confidence score, so it skips that gate too."""
        mandate = self.db.get_mandate_for_session(session_id)
        item = self.call_tool("get_availability", {"item_id": item_id})

        allowed_categories = mandate.get("allowed_categories") or []
        allowed_merchants = mandate.get("allowed_merchants") or []
        if allowed_categories and item["category"] not in allowed_categories:
            return OrchestratorResult(
                state="REFUSED",
                message=f"'{item['title']}' is outside the categories this mandate allows.",
                rule_cited="category_not_allowed",
            )
        if allowed_merchants and item["merchant_id"] not in allowed_merchants:
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
        return self._compose_and_checkout(session_id, candidate, intent, mandate, skip_confidence_gate=True)

    def _compose_and_checkout(
        self,
        session_id: str,
        candidate: Candidate,
        intent: Intent,
        mandate: dict,
        skip_confidence_gate: bool = False,
    ) -> OrchestratorResult:
        # Compose the cart (+ upsell + confidence), bounded to allowed categories.
        cart = self.cart_composer.compose(
            session_id,
            candidate,
            intent,
            allowed_categories=mandate.get("allowed_categories"),
        )

        # Low confidence → route to human (same first-class path as AFA) —
        # skipped when a human already explicitly picked this exact item.
        if not skip_confidence_gate and cart.confidence < CONFIDENCE_THRESHOLD:
            return OrchestratorResult(
                state="NEEDS_HUMAN",
                message="I'm not confident this matches your intent — please confirm.",
                rule_cited="low_confidence",
                cart_id=cart.cart_id,
            )

        # Gate: the orchestrator (only) submits the cart to the kernel.
        return self._checkout(session_id, cart.cart_id, afa_approved=False)

    def approve(self, session_id: str, cart_id: str) -> OrchestratorResult:
        """Resume a NEEDS_HUMAN session after the human's PIN-equivalent approval
        (clears the ₹15,000 AFA gate; all other bounds still enforced)."""
        return self._checkout(session_id, cart_id, afa_approved=True)

    def _checkout(self, session_id: str, cart_id: str, afa_approved: bool) -> OrchestratorResult:
        res = self.call_tool(
            "checkout",
            {"session_id": session_id, "cart_id": cart_id, "afa_approved": afa_approved},
        )
        verdict = res["verdict"]
        if verdict == "approved":
            return OrchestratorResult(
                state="AUTHORIZED",
                message=f"Approved. Complete payment: {res.get('payment_link')}",
                verdict=verdict,
                payment_link=res.get("payment_link"),
                cart_id=cart_id,
            )
        if verdict == "needs_human":
            return OrchestratorResult(
                state="NEEDS_HUMAN",
                message=res.get("human_message") or "This purchase needs your approval.",
                verdict=verdict,
                rule_cited=res.get("rule_cited"),
                cart_id=cart_id,
            )
        return OrchestratorResult(
            state="REFUSED",
            message=res.get("human_message") or "This purchase was declined.",
            verdict=verdict,
            rule_cited=res.get("rule_cited"),
            cart_id=cart_id,
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
