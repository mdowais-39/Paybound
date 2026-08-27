"""Cart-Composer worker: assembles the cart via create_cart and returns a
structured cart + a confidence score. It cannot submit the cart itself — only
the orchestrator calls checkout.

When the trained models are provided it uses them; otherwise it falls back to
heuristics (so tests run without artifacts):
  - upsell (Instacart/ESCI-C/Amazon) proposes a complement in an allowed category
  - the Purchase Confidence Scorer (gradient-boosted) replaces the heuristic.

A proposed complement is never added to the cart automatically — `find_upsell`
only PROPOSES one (read-only, no cart is touched). The orchestrator decides
whether to offer it to the human, and `compose` only adds it when the caller
explicitly passes back the accepted `addon_item_id` — the human's call, not
the agent's, per Rule 9's spirit of never letting the agent decide on its own."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Candidate, ComposedCart, Intent


class CartComposer(BaseAgent):
    def __init__(self, mcp, request_budget: int = 12, upsell=None, confidence=None, relevance=None):
        super().__init__(mcp, name="cart_composer", request_budget=request_budget)
        self.upsell = upsell
        self.confidence = confidence
        #: The relevance ranker, used ONLY for its MiniLM embedder so the
        #: complement lookup can drive the storefront's semantic search (the
        #: same pgvector path search uses) instead of literal category strings.
        self.relevance = relevance

    def compose(
        self,
        session_id: str,
        chosen: Candidate,
        intent: Intent,
        clarification_turns: int = 0,
        addon_item_id: str | None = None,
    ) -> ComposedCart:
        """Build and submit the cart: `chosen` always, plus `addon_item_id`
        ONLY when given — i.e. only after the human explicitly accepted it via
        POST /sessions/{id}/upsell. Never looks up or auto-adds a complement
        itself; see `find_upsell` for that (a separate, read-only proposal)."""
        items = [{"item_id": chosen.item_id, "qty": 1}]
        # Human-readable line items for display, built from data we already
        # have — real catalog values, never fabricated. `is_upsell` marks the
        # accepted complement line so the UI can label it as a suggestion the
        # customer opted into, not something bundled in silently.
        display_items = [
            {
                "item_id": chosen.item_id,
                "title": chosen.title,
                "qty": 1,
                "price_paise": chosen.price_paise,
                "category": chosen.category,
                "is_upsell": False,
            }
        ]

        upsold = addon_item_id is not None
        if addon_item_id is not None:
            addon = self.call_tool("get_availability", {"item_id": addon_item_id})
            items.append({"item_id": addon_item_id, "qty": 1})
            display_items.append(
                {
                    "item_id": addon["item_id"],
                    "title": addon.get("title", ""),
                    "qty": 1,
                    "price_paise": addon["price_paise"],
                    "category": addon["category"],
                    "is_upsell": True,
                }
            )

        cart = self.call_tool("create_cart", {"session_id": session_id, "items": items})
        confidence = self._confidence(chosen, intent, cart, clarification_turns, upsold)
        return ComposedCart(
            cart_id=cart["cart_id"],
            total_paise=cart["total_paise"],
            line_items=cart.get("line_items", []),
            confidence=confidence,
            display_items=display_items,
        )

    def find_upsell(
        self, chosen: Candidate, allowed_categories: list[str] | None, intent: Intent
    ) -> dict | None:
        """PROPOSE one complement item — read-only, does not touch the cart or
        call create_cart. The orchestrator shows this to the human (state=
        UPSELL) and only feeds its item_id back into `compose` if they accept.

        The trained co-purchase table supplies WHICH categories complement the
        chosen one (`complement_categories_for`, which itself bridges an unseen
        catalog category to its nearest trained key by embedding). Each
        complement category then drives the storefront's SEMANTIC search (the
        same MiniLM/pgvector path search uses) — so a complement concept like
        'socks' matches the nearest real product even when the catalog has no
        category literally named 'socks', instead of requiring an exact string
        match. The mandate is still enforced on the RETURNED item's real
        category, and a complement must be a DIFFERENT category than the chosen
        item (a complement, not more of the same)."""
        if self.upsell is None:
            return None
        # An empty/absent allow-list means the mandate is UNRESTRICTED (same
        # convention as the kernel: `allowed_categories.is_empty()` = any
        # category passes) — not "nothing is allowed". `allowed = None` below
        # skips the scope filter entirely in that case.
        allowed = set(allowed_categories) if allowed_categories else None
        cap = intent.max_price_paise
        for comp_cat in self.upsell.complement_categories_for(chosen.category):
            args: dict = {"query": comp_cat, "limit": 10}
            if self.relevance is not None:
                try:
                    args["query_embedding"] = self.relevance.embed_query(comp_cat)
                except Exception:  # noqa: BLE001
                    pass  # fall back to keyword search
            hits = self.call_tool("search_catalog", args)
            for it in hits.get("items", []):
                if it["item_id"] == chosen.item_id:
                    continue
                # A complement is a DIFFERENT category, not more of the same item.
                if it["category"] == chosen.category:
                    continue
                # Enforce the mandate on the ITEM's real category (semantic search
                # may return a category other than the complement concept).
                if allowed is not None and it["category"] not in allowed:
                    continue
                # Single-merchant carts, and within any stated price limit.
                if chosen.merchant_id and it.get("merchant_id") != chosen.merchant_id:
                    continue
                if cap is None or it["price_paise"] <= cap:
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
