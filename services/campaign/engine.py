"""Campaign orchestrator rule engine — a pure, deterministic evaluator that
proposes at most ONE in-app nudge (cross-sell / win-back) from a mandate's
REAL purchase history.

It never touches money: it only ever returns a natural-language goal + a
human-readable reason. If the human accepts, that goal is handed to the
ordinary, fully kernel-gated `/run` pipeline — so a campaign nudge can never
bypass a bound the kernel enforces, exactly like a CHOOSE or UPSELL suggestion.
Mirrors the kernel's own 'pure function over data' design (no I/O in the
decision itself; `now` is passed in, the catalog read goes through the
injected mcp), so the whole thing is unit-testable in isolation.

Cross-sell reuses the SAME `CartComposer.find_upsell` that runs live during
checkout — no parallel matching logic. The only difference is it's aimed at a
past purchase instead of an in-flight cart."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta

from ..agent.models import Candidate, Intent

#: How stale a mandate's last purchase must be before a win-back nudge fires.
WIN_BACK_DAYS = 14


@dataclass
class CampaignOffer:
    campaign_type: str  # "complete_the_set" | "win_back"
    reason: str  # human-readable, grounded in real data
    suggested_goal: str  # natural-language goal to run on accept
    item_id: str | None = None
    category: str | None = None


def _rupees(paise: int) -> str:
    return f"₹{(paise or 0) // 100:,}"


class CampaignEngine:
    """`cart_composer` supplies the (already-loaded) upsell + relevance models
    for cross-sell matching; `mcp` supplies live catalog reads (get_availability)
    to reconstruct the past purchase's chosen item. Both are the same objects
    the /run pipeline already uses — nothing new is trained or loaded here."""

    def __init__(self, cart_composer, mcp):
        self.cart_composer = cart_composer
        self.mcp = mcp

    def evaluate(
        self,
        mandate: dict,
        running_spend_paise: int,
        runs: list[dict],
        now: datetime,
    ) -> CampaignOffer | None:
        """Return at most one offer. `runs` is the mandate's agent_run history,
        NEWEST-FIRST (as `agent_run` is indexed). Re-checks the mandate's
        CURRENT bounds — a nudge is never proposed for a mandate that can no
        longer spend, even if it could when the original purchase happened."""
        # Bound re-check: expired or fully-spent mandates get no nudge. (A
        # revoked mandate never reaches here — the route wouldn't resolve it —
        # but TTL and remaining budget are re-verified regardless.)
        ttl_unix = mandate.get("ttl_unix")
        if ttl_unix is not None and now.timestamp() > ttl_unix:
            return None
        remaining = mandate.get("budget_total_paise", 0) - running_spend_paise
        if remaining <= 0:
            return None

        completed = [r for r in runs if r.get("state") in ("AUTHORIZED", "COMPLETED")]
        if not completed:
            return None

        return self._complete_the_set(mandate, remaining, completed) or self._win_back(
            completed, now
        )

    # --- Rule A: complete the set (cross-sell) -----------------------------

    def _complete_the_set(
        self, mandate: dict, remaining: int, completed: list[dict]
    ) -> CampaignOffer | None:
        last = completed[0]  # newest completed purchase
        item_id = self._primary_item_id(last)
        if not item_id:
            return None
        try:
            item = self.mcp.call_tool("get_availability", {"item_id": item_id})
        except Exception:  # noqa: BLE001 — a missing/renamed item just means no nudge
            return None

        chosen = Candidate(
            item_id=item["item_id"],
            title=item["title"],
            category=item["category"],
            price_paise=item["price_paise"],
            merchant_id=item.get("merchant_id"),
        )
        # Cap the complement at what THIS mandate could actually approve now —
        # min(remaining budget, per-txn cap). Even if this is loose, the real
        # purchase still passes the full kernel gate on accept.
        cap = min(remaining, mandate.get("per_txn_cap_paise") or remaining)
        intent = Intent(query=chosen.title, max_price_paise=cap)

        addon = self.cart_composer.find_upsell(
            chosen, mandate.get("allowed_categories"), intent
        )
        if addon is None:
            return None
        # Don't nudge a category the customer has already bought before.
        already = {c for r in completed for c in self._categories(r)}
        if addon["category"] in already:
            return None

        return CampaignOffer(
            campaign_type="complete_the_set",
            reason=(
                f"You recently bought {chosen.title}. Customers often pair it with "
                f"{addon['title']} ({_rupees(addon['price_paise'])}) — want to take a look?"
            ),
            suggested_goal=f"buy {addon['category']}",
            item_id=addon["item_id"],
            category=addon["category"],
        )

    # --- Rule B: win-back --------------------------------------------------

    def _win_back(self, completed: list[dict], now: datetime) -> CampaignOffer | None:
        last = completed[0]
        created = last.get("created_at")
        if created is None or (now - created) < timedelta(days=WIN_BACK_DAYS):
            return None
        cats = [c for r in completed for c in self._categories(r)]
        if not cats:
            return None
        top = Counter(cats).most_common(1)[0][0]
        return CampaignOffer(
            campaign_type="win_back",
            reason=(
                f"It's been a while since your last purchase. Want to see what's new in {top}?"
            ),
            suggested_goal=f"buy {top}",
            category=top,
        )

    # --- helpers -----------------------------------------------------------

    @staticmethod
    def _primary_item_id(run: dict) -> str | None:
        """The item the customer actually asked for (not an accepted add-on)."""
        cart = (run.get("result_json") or {}).get("cart") or {}
        items = cart.get("line_items", [])
        for li in items:
            if not li.get("is_upsell"):
                return li.get("item_id")
        return items[0].get("item_id") if items else None

    @staticmethod
    def _categories(run: dict) -> set[str]:
        cart = (run.get("result_json") or {}).get("cart") or {}
        return {
            li.get("category")
            for li in cart.get("line_items", [])
            if li.get("category")
        }
