"""Discovery / Search worker: calls search_catalog (+ get_variants) and ranks
the results. Returns structured candidates — it never builds a cart or checks
out. The trained relevance model swaps in behind `_rank` at Phase 7."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Candidate, Intent


class DiscoveryWorker(BaseAgent):
    def __init__(self, mcp, request_budget: int = 12):
        super().__init__(mcp, name="discovery", request_budget=request_budget)

    def search(
        self,
        intent: Intent,
        allowed_categories: list[str] | None = None,
        allowed_merchants: list[str] | None = None,
        limit: int = 20,
    ) -> list[Candidate]:
        """Search, then keep only items the mandate actually allows (a bounded
        shopper proposes only buyable items — the kernel is still the gate)."""
        result = self.call_tool("search_catalog", {"query": intent.query, "limit": limit})
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
                )
            )
        return self._rank(candidates, intent)

    def _rank(self, candidates: list[Candidate], intent: Intent) -> list[Candidate]:
        """Heuristic placeholder ranking (Phase 7 replaces with the ESCI-trained
        model behind this same method): keep items within budget, prefer the best
        affordable one (highest price at or under the ceiling)."""
        cap = intent.max_price_paise
        ranked = []
        for c in candidates:
            if cap is not None and c.price_paise > cap:
                continue
            c.score = float(c.price_paise)  # best affordable first
            ranked.append(c)
        ranked.sort(key=lambda c: c.score, reverse=True)
        return ranked

    def get_variants(self, item_id: str) -> dict:
        return self.call_tool("get_variants", {"item_id": item_id})
