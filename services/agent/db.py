"""Minimal DB access for the agent: read the mandate a session is bound to (for
pre-checks) and the session state. Read-only from the agent's side — all writes
happen inside the Rust services behind the tools."""

from __future__ import annotations

import os
from typing import Protocol

import psycopg


class Db(Protocol):
    def get_mandate_for_session(self, session_id: str) -> dict: ...
    def get_session_state(self, session_id: str) -> str: ...


class PgDb:
    def __init__(self, dsn: str | None = None):
        self.dsn = (dsn or os.environ.get("DATABASE_URL", "")).replace(
            "postgres://", "postgresql://", 1
        )

    def get_mandate_for_session(self, session_id: str) -> dict:
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT m.mandate_id, m.budget_total_paise, m.per_txn_cap_paise,
                          m.allowed_categories, m.allowed_merchants,
                          EXTRACT(EPOCH FROM m.ttl)::bigint AS ttl_unix, m.nl_goal
                   FROM purchase_session s JOIN intent_mandate m USING (mandate_id)
                   WHERE s.session_id = %s""",
                (session_id,),
            )
            row = cur.fetchone()
        if not row:
            raise LookupError(f"no mandate for session {session_id}")
        return {
            "mandate_id": str(row[0]),
            "budget_total_paise": row[1],
            "per_txn_cap_paise": row[2],
            "allowed_categories": row[3],
            "allowed_merchants": [str(x) for x in row[4]],
            "ttl_unix": row[5],
            "nl_goal": row[6],
        }

    def get_session_state(self, session_id: str) -> str:
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT state FROM purchase_session WHERE session_id = %s", (session_id,)
            )
            row = cur.fetchone()
        if not row:
            raise LookupError(f"no session {session_id}")
        return row[0]
