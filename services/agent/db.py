"""Minimal DB access for the agent: read the mandate a session is bound to (for
pre-checks) and the session state. Money/state writes all happen inside the Rust
services behind the tools (kernel-gated). The one write here — `record_run` — is
NOT a money/state mutation: it's an append-only console run LOG (the `agent_run`
read model), written as each run reaches its terminal state so the shopping
console can rebuild its cards from the database instead of per-browser storage.
The authoritative gate/payment/audit records still come only from Rust."""

from __future__ import annotations

import json
import os
from typing import Protocol

import psycopg
from psycopg_pool import ConnectionPool


class Db(Protocol):
    def get_mandate_for_session(self, session_id: str) -> dict: ...
    def get_session_state(self, session_id: str) -> str: ...
    def identity_exists(self, token_hash: str) -> bool: ...
    def get_session_owner(self, session_id: str) -> str | None: ...
    def record_run(self, run_id: str, session_id: str, goal: str, result: dict) -> None: ...


class PgDb:
    def __init__(self, dsn: str | None = None, pool: ConnectionPool | None = None):
        self.dsn = (dsn or os.environ.get("DATABASE_URL", "")).replace(
            "postgres://", "postgresql://", 1
        )
        #: Optional shared pool (built once at API startup, same precedent as
        #: the ML models) — every method below borrows a connection from it
        #: instead of paying a fresh TCP+TLS+auth handshake per call. Falls
        #: back to a direct per-call connect when no pool is given, so scripts
        #: and one-off tools can still construct a `PgDb()` on their own.
        self.pool = pool

    def _conn(self):
        return self.pool.connection() if self.pool is not None else psycopg.connect(self.dsn)

    def get_mandate_for_session(self, session_id: str) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
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
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT state FROM purchase_session WHERE session_id = %s", (session_id,)
            )
            row = cur.fetchone()
        if not row:
            raise LookupError(f"no session {session_id}")
        return row[0]

    def identity_exists(self, token_hash: str) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM identity WHERE token_hash = %s", (token_hash,))
            return cur.fetchone() is not None

    def get_session_owner(self, session_id: str) -> str | None:
        """A session's mandate's owner token hash, or None if the session
        doesn't exist (mirrors the gateway's ownership model exactly: a
        session with no owner — pre-auth data — is open to any identity)."""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT m.owner_token_hash FROM purchase_session s
                   JOIN intent_mandate m USING (mandate_id) WHERE s.session_id = %s""",
                (session_id,),
            )
            row = cur.fetchone()
        if not row:
            raise LookupError(f"no session {session_id}")
        return row[0]

    def record_run(self, run_id: str, session_id: str, goal: str, result: dict) -> None:
        """Upsert the console run log for `run_id`. Idempotent and stable across
        a run's run→select→approve steps (same run_id), so the row always holds
        the LATEST terminal result. mandate_id is taken from the session itself
        (a single INSERT…SELECT), so it can never disagree with the session. The
        full result is stored as JSONB for a faithful UI rebuild. Append-only
        LOG — never a money/state write."""
        total_paise = result.get("amount_paise")
        if total_paise is None:
            cart = result.get("cart") or {}
            total_paise = cart.get("total_paise") or 0
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO agent_run (
                       run_id, session_id, mandate_id, goal, state, verdict,
                       rule_cited, cart_id, total_paise, message, payment_link,
                       result_json, updated_at)
                   SELECT %(run_id)s, %(session_id)s, s.mandate_id, %(goal)s,
                          %(state)s, %(verdict)s, %(rule_cited)s, %(cart_id)s,
                          %(total_paise)s, %(message)s, %(payment_link)s,
                          %(result_json)s::jsonb, now()
                   FROM purchase_session s WHERE s.session_id = %(session_id)s
                   ON CONFLICT (run_id) DO UPDATE SET
                       goal = EXCLUDED.goal, state = EXCLUDED.state,
                       verdict = EXCLUDED.verdict, rule_cited = EXCLUDED.rule_cited,
                       cart_id = EXCLUDED.cart_id, total_paise = EXCLUDED.total_paise,
                       message = EXCLUDED.message, payment_link = EXCLUDED.payment_link,
                       result_json = EXCLUDED.result_json, updated_at = now()""",
                {
                    "run_id": run_id,
                    "session_id": session_id,
                    "goal": goal,
                    "state": result.get("state"),
                    "verdict": result.get("verdict"),
                    "rule_cited": result.get("rule_cited"),
                    "cart_id": result.get("cart_id"),
                    "total_paise": total_paise,
                    "message": result.get("message"),
                    "payment_link": result.get("payment_link"),
                    "result_json": json.dumps(result),
                },
            )
            conn.commit()
