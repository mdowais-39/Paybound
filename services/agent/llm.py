"""Provider-agnostic LLM client. The agent's reasoning goes through this
interface, so the provider (Gemini today) can be swapped without touching the
orchestrator. Every client tracks a `.calls` counter — used to *prove* that no
LLM call happens before the deterministic pre-checks pass."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Protocol

import requests

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Pinned (not "-latest"): the "-latest" alias silently floats onto whatever
# Google currently flags as newest, which can land on a preview-tier model with
# a much smaller free-tier daily quota (gemini-3.7-flash: 20 req/day — enough to
# exhaust in one demo run). Gemini quota is per-project-per-model, so a stable,
# explicit lite model keeps its own separate, larger allowance.
DEFAULT_MODEL = "gemini-3.5-flash-lite"


class LLM(Protocol):
    calls: int

    def complete_json(self, system: str, user: str) -> dict: ...


def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model response (handles ```json fences)."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    raw = fenced.group(1) if fenced else text
    brace = re.search(r"\{.*\}", raw, re.DOTALL)
    if not brace:
        raise ValueError(f"no JSON object in model response: {text[:200]!r}")
    return json.loads(brace.group(0))


class GeminiLLM:
    """Google Gemini via the AI Studio REST API (API key as ?key=)."""

    def __init__(self, api_key: str | None = None, model: str = DEFAULT_MODEL):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.model = model
        self.calls = 0

    def complete_json(self, system: str, user: str, retries: int = 3) -> dict:
        self.calls += 1
        url = GEMINI_URL.format(model=self.model)
        body = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        }
        last_err: Exception | None = None
        for attempt in range(retries):
            try:
                resp = requests.post(url, params={"key": self.api_key}, json=body, timeout=30)
                # Retry transient server errors (503/500/429).
                if resp.status_code in (429, 500, 503):
                    raise requests.HTTPError(f"transient {resp.status_code}")
                resp.raise_for_status()
                data = resp.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return _extract_json(text)
            except (requests.RequestException, KeyError, ValueError) as e:
                last_err = e
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"Gemini call failed after {retries} attempts: {last_err}")
