"""Database access for the campaign orchestrator — the two writes plus the
history reads the engine needs. A small dedicated class (its own psycopg
connection via DATABASE_URL), following the precedent of `services/explain/
narrator.py`, rather than growing `agent/db.py::PgDb` into a god-object.

Nothing here is money-critical: campaign_offer is an append-only read model
(what nudge was shown, and whether the human accepted or dismissed it), so it's
written directly from Python — the actual purchase a nudge leads to still goes
through the ordinary kernel-gated /run pipeline."""

from __future__ import annotations

import os

import psycopg

from .engine import CampaignOffer


class CampaignStore:
    def __init__(self, dsn: str | None = None):
        self.dsn = (dsn or os.environ.get("DATABASE_URL", "")).replace(
            "postgres://", "postgresql://", 1
        )

    def running_spend(self, session_id: str) -> int:
        """The session's committed spend — subtracted from the mandate budget
        to get remaining headroom for a nudge (an authorization hold, exactly
        as the kernel's own cumulative-budget check reads it)."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT running_spend_paise FROM purchase_session WHERE session_id = %s",
                (session_id,),
            )
            row = cur.fetchone()
        return int(row[0]) if row else 0

    def list_runs(self, mandate_id: str) -> list[dict]:
        """The mandate's agent_run history, newest-first — the real purchase
        record the engine reasons over. `result_json` comes back as a dict
        (JSONB auto-adapts)."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT state, result_json, created_at FROM agent_run
                   WHERE mandate_id = %s ORDER BY created_at DESC""",
                (mandate_id,),
            )
            rows = cur.fetchall()
        return [{"state": r[0], "result_json": r[1], "created_at": r[2]} for r in rows]

    def dismissed_item_ids(self, mandate_id: str) -> set[str]:
        """Every item this mandate has already explicitly dismissed a nudge
        for — the engine excludes these so a declined suggestion doesn't keep
        reappearing on a later evaluation (the 24h cooldown alone only blocks
        a NEW nudge of any kind; it doesn't remember which specific item was
        turned down)."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT DISTINCT item_id FROM campaign_offer
                   WHERE mandate_id = %s AND status = 'dismissed' AND item_id IS NOT NULL""",
                (mandate_id,),
            )
            return {str(r[0]) for r in cur.fetchall()}

    def dismissed_categories(self, mandate_id: str) -> set[str]:
        """Every category a win-back nudge for this mandate was already
        dismissed for — same purpose as `dismissed_item_ids`, but for win-back,
        which proposes a CATEGORY rather than a specific item."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT DISTINCT category FROM campaign_offer
                   WHERE mandate_id = %s AND status = 'dismissed'
                     AND campaign_type = 'win_back' AND category IS NOT NULL""",
                (mandate_id,),
            )
            return {r[0] for r in cur.fetchall()}

    def recent_offer(self, mandate_id: str, within_hours: int = 24) -> dict | None:
        """The most recent offer for this mandate inside the cooldown window,
        or None. Used to (a) keep re-showing an un-resolved offer across page
        loads, and (b) enforce the once-per-24h frequency cap after one is
        accepted/dismissed."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT offer_id, campaign_type, reason, suggested_goal, status
                   FROM campaign_offer
                   WHERE mandate_id = %s AND shown_at > now() - make_interval(hours => %s)
                   ORDER BY shown_at DESC LIMIT 1""",
                (mandate_id, within_hours),
            )
            row = cur.fetchone()
        return _row_to_offer(row) if row else None

    def insert_offer(self, mandate_id: str, offer: CampaignOffer) -> dict:
        """Persist a freshly-evaluated offer (status 'shown') and return it in
        the API shape."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO campaign_offer
                       (mandate_id, campaign_type, reason, suggested_goal, item_id, category)
                   VALUES (%s, %s, %s, %s, %s::uuid, %s)
                   RETURNING offer_id, campaign_type, reason, suggested_goal, status""",
                (
                    mandate_id,
                    offer.campaign_type,
                    offer.reason,
                    offer.suggested_goal,
                    offer.item_id,
                    offer.category,
                ),
            )
            row = cur.fetchone()
            conn.commit()
        return _row_to_offer(row)

    def resolve_offer(self, offer_id: str, status: str) -> bool:
        """Mark an offer accepted/dismissed. Only affects a still-'shown' row
        (idempotent — a double-resolve is a no-op). Returns whether a row
        changed."""
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """UPDATE campaign_offer SET status = %s, resolved_at = now()
                   WHERE offer_id = %s AND status = 'shown'""",
                (status, offer_id),
            )
            changed = cur.rowcount > 0
            conn.commit()
        return changed


def _row_to_offer(row: tuple) -> dict:
    return {
        "offer_id": str(row[0]),
        "campaign_type": row[1],
        "reason": row[2],
        "suggested_goal": row[3],
        "status": row[4],
    }
