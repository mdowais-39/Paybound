"""The agent HTTP API: a thin FastAPI shell around the existing Orchestrator,
so a browser frontend can drive a purchase without shelling out to a CLI.

No new business logic lives here — every rule (pre-checks, the kernel gate,
the state machine) already exists in `services.agent.orchestrator` and the
Rust kernel behind it. This module only adds an HTTP handle onto it: models,
LLM, and MCP client are built ONCE at startup (not per request) so requests
stay fast and the LLM-call counter (`orch.llm.calls`) is meaningful.

Run: uvicorn services.api.main:app --port 8090
     (or: bash scripts/run_agent_api.sh)
"""

from __future__ import annotations

import hashlib
import logging
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ..agent.db import PgDb
from ..agent.llm import GeminiLLM
from ..agent.mcp_client import HttpMcpClient
from ..agent.ml_loader import load_confidence, load_relevance, load_upsell
from ..agent.orchestrator import Orchestrator
from ..agent.tracing import flush, init_tracing

logger = logging.getLogger("paybound.api")

app = FastAPI(title="Paybound Agent API")

# Permissive CORS: this serves only test-mode, non-sensitive demo data (no
# auth, no PII) to a frontend that may run on any local port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_state: dict = {}


@app.on_event("startup")
def _startup() -> None:
    base_url = os.environ.get("STOREFRONT_URL", "http://localhost:8081")
    relevance, upsell, confidence = load_relevance(), load_upsell(), load_confidence()
    logger.info(
        "models loaded -> relevance:%s upsell:%s confidence:%s",
        relevance is not None, upsell is not None, confidence is not None,
    )
    _state["mcp"] = HttpMcpClient(base_url)
    _state["db"] = PgDb()
    _state["relevance"] = relevance
    _state["upsell"] = upsell
    _state["confidence"] = confidence
    _state["tracer"] = init_tracing()


@app.on_event("shutdown")
def _shutdown() -> None:
    flush()


def _orchestrator() -> Orchestrator:
    # A fresh GeminiLLM per request (it's a stateless client; `.calls` should
    # count only this request's LLM usage, not accumulate across requests).
    return Orchestrator(
        _state["mcp"], GeminiLLM(), _state["db"],
        relevance=_state["relevance"], upsell=_state["upsell"], confidence=_state["confidence"],
    )


class RunRequest(BaseModel):
    goal: str


class ApproveRequest(BaseModel):
    cart_id: str


class SelectRequest(BaseModel):
    item_id: str


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _authenticate(authorization: str | None) -> str:
    """Verify `Authorization: Bearer <token>` against the same `identity`
    table the gateway checks, and return the token's hash. Mirrors the
    gateway's `authenticate` exactly, so a token minted via `POST /identity`
    (gateway) works here too — one identity, both services."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing Authorization: Bearer <token>")
    token_hash = _hash_token(authorization.removeprefix("Bearer "))
    if not _state["db"].identity_exists(token_hash):
        raise HTTPException(status_code=401, detail="unknown or invalid token")
    return token_hash


def _require_session_owner(session_id: str, owner_hash: str) -> None:
    """Mirrors the gateway's ownership rule: a session with no owner
    (pre-auth data) stays open to any identity; otherwise it must match."""
    try:
        owner = _state["db"].get_session_owner(session_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if owner is not None and owner != owner_hash:
        raise HTTPException(status_code=403, detail="not your session")


def _result_json(orch: Orchestrator, result, trace_id: str | None) -> dict:
    return {
        "state": result.state,
        "message": result.message,
        "verdict": result.verdict,
        "rule_cited": result.rule_cited,
        "payment_link": result.payment_link,
        "clarification_question": result.clarification_question,
        "cart_id": result.cart_id,
        "options": result.options,
        "trace_id": trace_id,
        "llm_calls": orch.llm.calls,
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "paybound-agent-api"}


@app.post("/sessions/{session_id}/run")
def run_session(session_id: str, req: RunRequest, authorization: str | None = Header(None)) -> dict:
    """Run the agent on one natural-language goal against an existing session
    (created via the gateway's `POST /mandates`). Safe to call repeatedly on
    the same session for a new goal each time — spend accumulates correctly
    because it's the same session's `running_spend_paise` the kernel checks."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    orch = _orchestrator()
    tracer = _state["tracer"]
    trace_id = None
    try:
        with tracer.start_as_current_span("purchase") as span:
            span.set_attribute("goal", req.goal)
            span.set_attribute("session_id", session_id)
            result = orch.run(session_id, req.goal)
            trace_id = format(span.get_span_context().trace_id, "032x")
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("agent run failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _result_json(orch, result, trace_id)


@app.post("/sessions/{session_id}/select")
def select_option(session_id: str, req: SelectRequest, authorization: str | None = Header(None)) -> dict:
    """Resume a CHOOSE session after the human picked one of the offered
    items (POST /sessions/{id}/run returned state=CHOOSE with an `options`
    list). No LLM call — a human naming the exact item is resolved
    deterministically, not re-interpreted."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    orch = _orchestrator()
    tracer = _state["tracer"]
    trace_id = None
    try:
        with tracer.start_as_current_span("select") as span:
            span.set_attribute("session_id", session_id)
            span.set_attribute("item_id", req.item_id)
            result = orch.select(session_id, req.item_id)
            trace_id = format(span.get_span_context().trace_id, "032x")
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("agent select failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _result_json(orch, result, trace_id)


@app.post("/sessions/{session_id}/approve")
def approve_session(session_id: str, req: ApproveRequest, authorization: str | None = Header(None)) -> dict:
    """Human approval for a NEEDS_HUMAN session (the >₹15,000 AFA gate, or a
    low-confidence match) — resumes checkout with the PIN-equivalent flag set.
    All other kernel bounds still apply; approval cannot exceed the per-txn
    cap or budget."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    orch = _orchestrator()
    tracer = _state["tracer"]
    trace_id = None
    try:
        with tracer.start_as_current_span("approve") as span:
            span.set_attribute("session_id", session_id)
            span.set_attribute("cart_id", req.cart_id)
            result = orch.approve(session_id, req.cart_id)
            trace_id = format(span.get_span_context().trace_id, "032x")
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("agent approve failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _result_json(orch, result, trace_id)
