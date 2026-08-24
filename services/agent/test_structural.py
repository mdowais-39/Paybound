"""Structural guarantee: the `checkout` tool is called ONLY from the orchestrator.
A worker gaining a checkout path would defeat the whole pipeline, so we assert it
at the source level (complementing the runtime UnauthorizedTool guardrail)."""

from pathlib import Path

WORKERS = Path(__file__).parent / "workers"
ORCH = Path(__file__).parent / "orchestrator.py"

# The `checkout` tool name is passed as a quoted literal to call_tool. Only the
# orchestrator should contain it. (Worker docstrings say the word "checkout"
# without quotes, so matching the quoted literal is precise.)
_CHECKOUT_LITERALS = ('"checkout"', "'checkout'")


def test_no_worker_calls_checkout():
    for f in WORKERS.glob("*.py"):
        src = f.read_text(encoding="utf-8")
        for literal in _CHECKOUT_LITERALS:
            assert literal not in src, f"{f.name} must not reference the checkout tool"


def test_orchestrator_is_the_checkout_caller():
    src = ORCH.read_text(encoding="utf-8")
    assert any(lit in src for lit in _CHECKOUT_LITERALS), "orchestrator must be the checkout caller"
