"""Discovery / Search worker: calls search_catalog (+ get_variants) and ranks
the results. Returns structured candidates — it never builds a cart or checks
out. The trained relevance model swaps in behind `_rank` at Phase 7."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Candidate, Intent, SearchOutcome


class DiscoveryWorker(BaseAgent):
    def __init__(self, mcp, request_budget: int = 12, relevance=None):
        super().__init__(mcp, name="discovery", request_budget=request_budget)
        #: Optional trained relevance ranker (ESCI). If None, uses the heuristic.
        self.relevance = relevance

    def search(
        self,
        intent: Intent,
        allowed_categories: list[str] | None = None,
        allowed_merchants: list[str] | None = None,
        limit: int = 20,
    ) -> SearchOutcome:
        """Search, keep only items the mandate allows and the customer can
        afford, and rank them. When nothing survives, report WHICH filter
        emptied the pool (no catalog match / price / category / merchant) so
        the customer gets a specific explanation, not a vague miss."""
        args: dict = {"query": intent.query, "limit": limit}
        # When the trained ranker is present, embed the query with the SAME
        # MiniLM model whose embeddings sit in the catalog, so the storefront
        # can do semantic (meaning-based) search — this is what lets "office
        # chair" find chairs filed under "home furniture", not just literal
        # keyword hits. Best-effort: any failure falls back to keyword search.
        if self.relevance is not None:
            try:
                args["query_embedding"] = self.relevance.embed_query(intent.query)
            except Exception:  # noqa: BLE001
                pass
        result = self.call_tool("search_catalog", args)
        raw = result.get("items", [])
        if not raw:
            return SearchOutcome([], reason="no_match")

        cats = set(allowed_categories or [])
        merchants = set(allowed_merchants or [])
        matched_categories = {it["category"] for it in raw}

        in_scope = [
            Candidate(
                item_id=it["item_id"],
                title=it["title"],
                category=it["category"],
                price_paise=it["price_paise"],
                merchant_id=it.get("merchant_id"),
            )
            for it in raw
            if (not cats or it["category"] in cats)
            and (not merchants or it.get("merchant_id") in merchants)
        ]
        if not in_scope:
            # The scope filters removed everything — say which axis, preferring
            # category (the more common, more legible restriction).
            if cats and not (matched_categories & cats):
                return SearchOutcome(
                    [], reason="category", detail={"matched": sorted(matched_categories)[:5]}
                )
            return SearchOutcome([], reason="merchant")

        cap = intent.max_price_paise
        affordable = [c for c in in_scope if cap is None or c.price_paise <= cap]
        if not affordable:
            return SearchOutcome(
                [],
                reason="price",
                detail={"cap_paise": cap, "cheapest_paise": min(c.price_paise for c in in_scope)},
            )
        return SearchOutcome(self._rank(affordable, intent))

    def _rank(self, affordable: list[Candidate], intent: Intent) -> list[Candidate]:
        """Rank the already-affordable, in-scope candidates by the ESCI-trained
        relevance model when available (heuristic fallback otherwise)."""
        if self.relevance is not None:
            rows = [{"title": c.title, "_c": c} for c in affordable]
            ranked = self.relevance.rank(intent.query, rows, title_key="title")
            return [r["_c"] for r in ranked]
        # heuristic fallback: best affordable (highest price at/under the cap)
        for c in affordable:
            c.score = float(c.price_paise)
        affordable.sort(key=lambda c: c.score, reverse=True)
        return affordable

    def get_variants(self, item_id: str) -> dict:
        return self.call_tool("get_variants", {"item_id": item_id})
