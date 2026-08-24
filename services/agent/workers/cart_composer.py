"""Cart-Composer worker: assembles the cart via create_cart and returns a
structured cart + a confidence score. It cannot submit the cart itself — only
the orchestrator calls checkout. The upsell model and the trained Purchase
Confidence Scorer land at Phase 7 behind `_confidence`/`_upsell`."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Candidate, ComposedCart, Intent


class CartComposer(BaseAgent):
    def __init__(self, mcp, request_budget: int = 12):
        super().__init__(mcp, name="cart_composer", request_budget=request_budget)

    def compose(self, session_id: str, chosen: Candidate, intent: Intent) -> ComposedCart:
        cart = self.call_tool(
            "create_cart",
            {"session_id": session_id, "items": [{"item_id": chosen.item_id, "qty": 1}]},
        )
        confidence = self._confidence(chosen, intent)
        return ComposedCart(
            cart_id=cart["cart_id"],
            total_paise=cart["total_paise"],
            line_items=cart.get("line_items", []),
            confidence=confidence,
        )

    def _confidence(self, chosen: Candidate, intent: Intent) -> float:
        """Heuristic confidence (Phase 7 replaces with the trained gradient-boosted
        Purchase Confidence Scorer). High when the item is comfortably within an
        explicit budget and its category matches; lower otherwise."""
        score = 0.6
        if intent.max_price_paise and chosen.price_paise <= intent.max_price_paise:
            score += 0.3
        if intent.category and intent.category == chosen.category:
            score += 0.1
        return round(min(score, 1.0), 3)
