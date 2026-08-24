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
from .tracing import flush, init_tracing


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
    tracer = init_tracing()
    with tracer.start_as_current_span("purchase") as span:
        span.set_attribute("goal", goal)
        span.set_attribute("session_id", session_id)
        result = orch.run(session_id, goal)
        trace_id = format(span.get_span_context().trace_id, "032x")
    print(f"TRACE ID: {trace_id}  (one distributed trace: agent -> storefront -> execution -> Razorpay)")

    print(f"STATE   : {result.state}")
    print(f"MESSAGE : {result.message}")
    if result.verdict:
        print(f"VERDICT : {result.verdict}  (rule: {result.rule_cited})")
    if result.payment_link:
        print(f"PAY LINK: {result.payment_link}")
    if result.clarification_question:
        print(f"ASK     : {result.clarification_question}")
    print(f"\nLLM calls made: {orch.llm.calls}")
    flush()  # export spans before exit
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
