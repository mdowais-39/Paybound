"""Clarification worker: fires on ambiguous intent or low confidence. It asks
the human a follow-up question instead of guessing — the graceful-failure hero
move ('asks, doesn't guess'). It touches no tools and cannot checkout."""

from __future__ import annotations

from ..base_agent import BaseAgent
from ..models import Intent


class ClarificationWorker(BaseAgent):
    def __init__(self, mcp=None, request_budget: int = 12):
        super().__init__(mcp, name="clarification", request_budget=request_budget)

    def ask(self, intent: Intent) -> str:
        """Return the follow-up question for an ambiguous goal."""
        if intent.clarification_question:
            return intent.clarification_question
        return (
            "Could you be more specific about what you'd like to buy — "
            "a category, and any budget or brand preference?"
        )
