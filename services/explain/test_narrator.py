"""The narrator DESCRIBES, never decides: it is fed the already-made decision and
returns the LLM's one-sentence description. These tests need no DB/LLM."""

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
