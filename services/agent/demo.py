"""Live agent demo: drive a real natural-language purchase through the whole
pipeline — real Gemini goal-parsing, the real storefront MCP tools, the Rust
kernel gate, and the real execution plane (payment link).

Run (after seeding a session and starting the storefront server):
    python -m services.agent.demo <session_id> "buy running shoes under 3000"
"""

from __future__ import annotations

import os
import sys

from .db import PgDb
from .llm import GeminiLLM
from .mcp_client import HttpMcpClient
from .ml_loader import load_confidence, load_relevance, load_upsell
from .orchestrator import Orchestrator


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python -m services.agent.demo <session_id> [goal]", file=sys.stderr)
        return 2
    session_id = sys.argv[1]
    goal = sys.argv[2] if len(sys.argv) > 2 else "buy running shoes under 3000"

    base_url = os.environ.get("STOREFRONT_URL", "http://localhost:8081")
    relevance, upsell, confidence = load_relevance(), load_upsell(), load_confidence()
    print(
        "models loaded -> "
        f"relevance:{relevance is not None} upsell:{upsell is not None} confidence:{confidence is not None}\n"
    )
    orch = Orchestrator(
        HttpMcpClient(base_url), GeminiLLM(), PgDb(),
        relevance=relevance, upsell=upsell, confidence=confidence,
    )

    print(f'GOAL: "{goal}"\n')
    result = orch.run(session_id, goal)

    print(f"STATE   : {result.state}")
    print(f"MESSAGE : {result.message}")
    if result.verdict:
        print(f"VERDICT : {result.verdict}  (rule: {result.rule_cited})")
    if result.payment_link:
        print(f"PAY LINK: {result.payment_link}")
    if result.clarification_question:
        print(f"ASK     : {result.clarification_question}")
    print(f"\nLLM calls made: {orch.llm.calls}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
