"""Audit-trail narrator. Given each already-made decision on a session's hash-
chained ledger, it writes a one-sentence plain-language justification into
`audit_entry.narrative`.

Crucial invariant (architecture §4.7): the LLM **describes, never decides**. It
is fed the decision that already happened and asked only to explain it; the
narrative is a separate persisted field that is NOT part of the hash (so adding
it never affects `verify_chain`). A narrative can therefore never change a money
outcome — at worst it is a bad description, caught by the spot-check.

Wired into the live pipeline as a fire-and-forget background call after every
agent-API purchase step (see services/api/main.py `_narrate_async`) — a Gemini
call never adds latency to the user-facing purchase response, and a narration
failure never surfaces to the user (`narrate_entry` degrades to a deterministic
sentence on its own).

Run by hand: python -m services.explain.narrator <session_id>
        or:  python -m services.explain.narrator --all   (backfill every
             session with any not-yet-narrated entry, e.g. after enabling
             this for the first time, or recovering from an outage)
"""

from __future__ import annotations

import json
import logging
import os
import sys

from services.agent.llm import GeminiLLM

logger = logging.getLogger("paybound.narrator")

_SYSTEM = (
    "You are an audit narrator for a payments system. You are given ONE decision "
    "that has ALREADY been made (its event type and data). Write a single, plain, "
    "past-tense sentence describing what happened and why. You DESCRIBE ONLY — you "
    "never approve, change, re-judge, or second-guess the decision. Money values "
    "are in paise; show them as ₹ (divide by 100). Be concise and factual. "
    'Return JSON: {"narrative": "<one sentence>"}.'
)


def build_prompt(event_type: str, payload: dict) -> str:
    return json.dumps({"event_type": event_type, "data": payload}, ensure_ascii=False)


class Narrator:
    def __init__(self, llm=None, dsn: str | None = None):
        self.llm = llm or GeminiLLM()
        self.dsn = (dsn or os.environ.get("DATABASE_URL", "")).replace(
            "postgres://", "postgresql://", 1
        )

    def narrate_entry(self, event_type: str, payload: dict) -> str:
        """Produce a faithful one-sentence narrative for a single decision.
        Never raises: if the LLM is unavailable (outage / rate limit), falls
        back to a deterministic sentence. The narrative is cosmetic and not
        part of the hash chain, so degrading it is always safe — unlike the
        kernel's decision, which this never touches."""
        try:
            data = self.llm.complete_json(_SYSTEM, build_prompt(event_type, payload))
            return str(data.get("narrative", "")).strip()
        except Exception as e:  # noqa: BLE001
            logger.warning("narration_failed_using_fallback", extra={"error": str(e)})
            return f"{event_type.replace('_', ' ')}: {json.dumps(payload, ensure_ascii=False)}"

    def narrate_session(self, session_id: str) -> int:
        """Narrate every not-yet-narrated entry on a session. Returns the count.
        Commits after each entry so a later failure never loses earlier progress."""
        import psycopg

        narrated = 0
        with psycopg.connect(self.dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT entry_id, event_type, payload FROM audit_entry "
                    "WHERE session_id = %s AND narrative IS NULL ORDER BY seq ASC",
                    (session_id,),
                )
                rows = cur.fetchall()
            for entry_id, event_type, payload in rows:
                text = self.narrate_entry(event_type, payload)
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE audit_entry SET narrative = %s WHERE entry_id = %s",
                        (text, entry_id),
                    )
                conn.commit()
                narrated += 1
        return narrated

    def narrate_all_pending(self) -> int:
        """Narrate every not-yet-narrated entry across ALL sessions — a one-time
        backfill for entries recorded before narration was wired into the live
        pipeline (or a recovery sweep after an outage). Returns the total count."""
        import psycopg

        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT DISTINCT session_id FROM audit_entry WHERE narrative IS NULL")
            session_ids = [str(r[0]) for r in cur.fetchall()]
        return sum(self.narrate_session(sid) for sid in session_ids)


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "--all":
        n = Narrator().narrate_all_pending()
        print(f"narrated {n} audit entries across all pending sessions")
        return 0
    n = Narrator().narrate_session(sys.argv[1])
    print(f"narrated {n} audit entries for session {sys.argv[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
