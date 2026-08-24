"""Base Agent — the shared abstraction the orchestrator and every worker inherit.

It implements the bounded-autonomy safety behaviour ONCE so it can't drift
between agents: a per-session request budget, structured logging of every tool
call, and a guardrail that only a checkout-authorised agent (the orchestrator)
may call the `checkout` tool. Workers physically cannot spend."""

from __future__ import annotations

import logging

from .mcp_client import Mcp

logger = logging.getLogger("paybound.agent")


class RequestBudgetExceeded(RuntimeError):
    pass


class UnauthorizedTool(RuntimeError):
    pass


class BaseAgent:
    #: Only the Orchestrator overrides this to True. Workers can never checkout.
    allow_checkout: bool = False

    def __init__(self, mcp: Mcp, name: str, request_budget: int = 12):
        self.mcp = mcp
        self.name = name
        self.request_budget = request_budget
        self.request_count = 0

    def _spend_request(self) -> None:
        self.request_count += 1
        if self.request_count > self.request_budget:
            raise RequestBudgetExceeded(
                f"{self.name} exceeded its request budget ({self.request_budget})"
            )

    def call_tool(self, name: str, arguments: dict) -> dict:
        """Call a storefront tool through the MCP boundary, with the checkout
        guardrail and structured logging."""
        if name == "checkout" and not self.allow_checkout:
            raise UnauthorizedTool(
                f"{self.name} is not permitted to call 'checkout' — only the orchestrator may"
            )
        self._spend_request()
        logger.info(
            "tool_call", extra={"agent": self.name, "tool": name, "args": arguments}
        )
        result = self.mcp.call_tool(name, arguments)
        logger.info("tool_result", extra={"agent": self.name, "tool": name})
        return result
