"""Audit-trail narrator. Given each already-made decision on a session's hash-
chained ledger, it writes a one-sentence plain-language justification into
`audit_entry.narrative`.

Crucial invariant (architecture §4.7): the LLM **describes, never decides**. It
is fed the decision that already happened and asked only to explain it; the
narrative is a separate persisted field that is NOT part of the hash (so adding
it never affects `verify_chain`). A narrative can therefore never change a money
outcome — at worst it is a bad description, caught by the spot-check.

Run: python -m services.explain.narrator <session_id>
"""

from __future__ import annotations

import json
import os
import sys

from services.agent.llm import GeminiLLM

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
        """Produce a faithful one-sentence narrative for a single decision."""
        data = self.llm.complete_json(_SYSTEM, build_prompt(event_type, payload))
        return str(data.get("narrative", "")).strip()

    def narrate_session(self, session_id: str) -> int:
        """Narrate every not-yet-narrated entry on a session. Returns the count."""
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
                narrated += 1
            conn.commit()
        return narrated


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python -m services.explain.narrator <session_id>", file=sys.stderr)
        return 2
    n = Narrator().narrate_session(sys.argv[1])
    print(f"narrated {n} audit entries for session {sys.argv[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
