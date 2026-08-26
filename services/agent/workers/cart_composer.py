"""Cart-Composer worker: assembles the cart via create_cart and returns a
structured cart + a confidence score. It cannot submit the cart itself — only
the orchestrator calls checkout.

When the trained models are provided it uses them; otherwise it falls back to
heuristics (so tests run without artifacts):
  - upsell (Instacart/ESCI-C/Amazon) suggests a complement in an allowed category
  - the Purchase Confidence Scorer (gradient-boosted) replaces the heuristic."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Candidate, ComposedCart, Intent


class CartComposer(BaseAgent):
    def __init__(self, mcp, request_budget: int = 12, upsell=None, confidence=None):
        super().__init__(mcp, name="cart_composer", request_budget=request_budget)
        self.upsell = upsell
        self.confidence = confidence

    def compose(
        self,
        session_id: str,
        chosen: Candidate,
        intent: Intent,
        allowed_categories: list[str] | None = None,
        clarification_turns: int = 0,
    ) -> ComposedCart:
        items = [{"item_id": chosen.item_id, "qty": 1}]
        # Human-readable line items for display, built from data we already
        # have (the chosen candidate + any complement from search) — real
        # catalog values, never fabricated.
        display_items = [
            {
                "item_id": chosen.item_id,
                "title": chosen.title,
                "qty": 1,
                "price_paise": chosen.price_paise,
                "category": chosen.category,
            }
        ]

        # Upsell: add ONE complement item, but only in a mandate-allowed category
        # (so the kernel still approves) and within budget.
        upsold = False
        complement = self._find_complement(chosen, allowed_categories, intent)
        if complement is not None:
            items.append({"item_id": complement["item_id"], "qty": 1})
            display_items.append(
                {
                    "item_id": complement["item_id"],
                    "title": complement.get("title", ""),
                    "qty": 1,
                    "price_paise": complement["price_paise"],
                    "category": complement["category"],
                }
            )
            upsold = True

        cart = self.call_tool("create_cart", {"session_id": session_id, "items": items})
        confidence = self._confidence(chosen, intent, cart, clarification_turns, upsold)
        return ComposedCart(
            cart_id=cart["cart_id"],
            total_paise=cart["total_paise"],
            line_items=cart.get("line_items", []),
            confidence=confidence,
            display_items=display_items,
        )

    def _find_complement(self, chosen: Candidate, allowed_categories, intent) -> dict | None:
        if self.upsell is None or not allowed_categories:
            return None
        allowed = set(allowed_categories)
        for comp_cat in self.upsell.complement_categories(chosen.category):
            if comp_cat not in allowed:
                continue
            hits = self.call_tool("search_catalog", {"query": comp_cat, "limit": 10})
            for it in hits.get("items", []):
                # Must be the same merchant (single-merchant carts) and in budget.
                if it["category"] != comp_cat or it["item_id"] == chosen.item_id:
                    continue
                if chosen.merchant_id and it.get("merchant_id") != chosen.merchant_id:
                    continue
                if intent.max_price_paise is None or it["price_paise"] <= intent.max_price_paise:
                    return it
        return None

    def _confidence(self, chosen, intent, cart, clarification_turns, upsold) -> float:
        if self.confidence is not None:
            budget = intent.max_price_paise or cart["total_paise"] or 1
            feat = {
                "cart_to_goal_match": 1.0 if (intent.category in (None, chosen.category)) else 0.4,
                "price_variance": abs(cart["total_paise"] - budget) / budget,
                "category_ambiguity": 0.1 if intent.category else 0.6,
                "clarification_turns": clarification_turns,
                "upsell_accepted": 1 if upsold else 0,
            }
            return round(self.confidence.score_purchase(feat), 3)
        # heuristic fallback
        score = 0.6
        if intent.max_price_paise and chosen.price_paise <= intent.max_price_paise:
            score += 0.3
        if intent.category and intent.category == chosen.category:
            score += 0.1
        return round(min(score, 1.0), 3)
