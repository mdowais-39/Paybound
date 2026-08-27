"""Discovery / Search worker: calls search_catalog (+ get_variants) and ranks
the results. Returns structured candidates — it never builds a cart or checks
out. The trained relevance model swaps in behind `_rank` at Phase 7."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Candidate, Intent


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
    ) -> list[Candidate]:
        """Search, then keep only items the mandate actually allows (a bounded
        shopper proposes only buyable items — the kernel is still the gate)."""
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
        cats = set(allowed_categories or [])
        merchants = set(allowed_merchants or [])
        candidates = []
        for it in result.get("items", []):
            if cats and it["category"] not in cats:
                continue
            if merchants and it.get("merchant_id") not in merchants:
                continue
            candidates.append(
                Candidate(
                    item_id=it["item_id"],
                    title=it["title"],
                    category=it["category"],
                    price_paise=it["price_paise"],
                    merchant_id=it.get("merchant_id"),
                )
            )
        return self._rank(candidates, intent)

    def _rank(self, candidates: list[Candidate], intent: Intent) -> list[Candidate]:
        """Keep items within budget, then rank by the ESCI-trained relevance
        model when available (falling back to a cheap heuristic)."""
        cap = intent.max_price_paise
        affordable = [c for c in candidates if cap is None or c.price_paise <= cap]
        if not affordable:
            return []
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
