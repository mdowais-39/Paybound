"""Pre-hand checks — fully DETERMINISTIC, run BEFORE any LLM call.

The point: reject what can be rejected without spending a single LLM token or
giving the agent any latitude to misjudge. Same "remove it from the choice set
before acting" instinct as the kernel, one layer earlier and cheaper.

Pure functions (no DB, no network): the orchestrator fetches the mandate and
passes it in, so these are trivially testable and provably pre-LLM."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

# Anti-runaway-loop guard: max tool/LLM calls per session.
DEFAULT_REQUEST_BUDGET = 12

# Prompt-injection patterns. Catalog-sourced text and the NL goal are scanned
# before they reach the reasoning loop; a hit is stripped/flagged and never
# granted tool-execution authority regardless of wording.
_INJECTION_PATTERNS = [
    r"ignore\b.{0,40}(instruction|prompt|rule|mandate)",
    r"disregard\b.{0,40}(instruction|prompt|rule|mandate|limit|cap)",
    r"system prompt",
    r"you are now",
    r"developer mode",
    r"raise\b.{0,20}(budget|cap|limit)",
    r"bypass\b.{0,20}(gate|kernel|check|limit|mandate)",
    r"approve\b.{0,30}(payment|purchase).{0,20}without",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)


@dataclass
class PrecheckResult:
    ok: bool
    reason: str | None = None  # a stable machine reason when not ok


def check_mandate_active(mandate: dict, now_unix: int | None = None) -> PrecheckResult:
    """The Intent Mandate must exist and be unexpired."""
    if not mandate:
        return PrecheckResult(False, "mandate_missing")
    now = now_unix if now_unix is not None else int(time.time())
    if mandate.get("ttl_unix", 0) <= now:
        return PrecheckResult(False, "mandate_expired")
    return PrecheckResult(True)


def check_goal_sanitised(goal: str) -> PrecheckResult:
    """The natural-language goal must be free of prompt-injection patterns."""
    if not goal or not goal.strip():
        return PrecheckResult(False, "empty_goal")
    if _INJECTION_RE.search(goal):
        return PrecheckResult(False, "prompt_injection_detected")
    return PrecheckResult(True)


def check_request_budget(request_count: int, budget: int = DEFAULT_REQUEST_BUDGET) -> PrecheckResult:
    """Bounded number of calls per session (anti-runaway)."""
    if request_count >= budget:
        return PrecheckResult(False, "request_budget_exhausted")
    return PrecheckResult(True)


def run_prechecks(
    mandate: dict,
    goal: str,
    request_count: int = 0,
    now_unix: int | None = None,
) -> PrecheckResult:
    """Run every pre-hand check in order. The FIRST failure short-circuits — and
    because this is called before any reasoning, a failure means zero LLM calls."""
    for result in (
        check_mandate_active(mandate, now_unix),
        check_goal_sanitised(goal),
        check_request_budget(request_count),
    ):
        if not result.ok:
            return result
    return PrecheckResult(True)
