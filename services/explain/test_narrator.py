"""The narrator DESCRIBES, never decides: it is fed the already-made decision and
returns the LLM's one-sentence description. These tests need no DB/LLM."""

from unittest.mock import MagicMock, patch

from services.explain.narrator import Narrator, build_prompt


class CapturingLLM:
    def __init__(self, narrative: str):
        self.narrative = narrative
        self.last_user = None

    def complete_json(self, system: str, user: str) -> dict:
        self.system = system
        self.last_user = user
        return {"narrative": self.narrative}


def test_prompt_carries_the_exact_decision():
    prompt = build_prompt("gate_decision", {"verdict": "refused", "rule_cited": "over_per_txn_cap"})
    assert "gate_decision" in prompt
    assert "over_per_txn_cap" in prompt and "refused" in prompt


def test_narrate_entry_returns_the_llm_description_and_is_fed_the_decision():
    llm = CapturingLLM("Refused the ₹4,200 cart as over the per-transaction cap.")
    narrator = Narrator(llm=llm, dsn="postgresql://x")
    text = narrator.narrate_entry("gate_decision", {"verdict": "refused", "amount_paise": 420000})
    assert text == "Refused the ₹4,200 cart as over the per-transaction cap."
    # The LLM was handed the actual decision (so it can only describe it).
    assert "refused" in llm.last_user and "420000" in llm.last_user
    # The narrator instructs describe-only.
    assert "DESCRIBE ONLY" in llm.system


def _mock_connection(rows: list[tuple]) -> MagicMock:
    """A psycopg-shaped mock: `with psycopg.connect(dsn) as conn, conn.cursor()
    as cur:` then `cur.fetchall()` returns `rows`."""
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.__exit__.return_value = False
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.__exit__.return_value = False
    cur.fetchall.return_value = rows
    conn.cursor.return_value = cur
    return conn


def test_narrate_all_pending_sums_across_every_pending_session():
    """The backfill sweep (`--all` / no session_id) — this is what closes the
    gap for entries recorded before narration was wired into the live
    pipeline: it must find EVERY session with a null narrative, not just one."""
    narrator = Narrator(llm=CapturingLLM("x"), dsn="postgresql://x")
    narrator.narrate_session = MagicMock(side_effect=[2, 3])

    with patch("psycopg.connect", return_value=_mock_connection([("sess-a",), ("sess-b",)])):
        total = narrator.narrate_all_pending()

    assert total == 5
    narrator.narrate_session.assert_any_call("sess-a")
    narrator.narrate_session.assert_any_call("sess-b")


def test_narrate_all_pending_is_a_noop_when_nothing_is_pending():
    narrator = Narrator(llm=CapturingLLM("x"), dsn="postgresql://x")
    narrator.narrate_session = MagicMock()

    with patch("psycopg.connect", return_value=_mock_connection([])):
        total = narrator.narrate_all_pending()

    assert total == 0
    narrator.narrate_session.assert_not_called()
