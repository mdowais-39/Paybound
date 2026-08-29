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

import asyncio
import hashlib
import json
import logging
import os
import threading
import uuid
from datetime import UTC, datetime

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..agent.db import PgDb
from ..agent.llm import GeminiLLM
from ..agent.mcp_client import HttpMcpClient
from ..agent.ml_loader import load_confidence, load_relevance, load_upsell
from ..agent.orchestrator import Orchestrator
from ..agent.tracing import flush, init_tracing
from ..campaign.db import CampaignStore
from ..campaign.engine import CampaignEngine
from ..explain.narrator import Narrator

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
    # Built once, like the ML models above — narrate_session opens its own DB
    # connection per call, so one shared instance is just avoiding repeated
    # GeminiLLM construction.
    _state["narrator"] = Narrator()
    # Campaign-offer store — its own psycopg connection per call, same pattern.
    _state["campaign"] = CampaignStore()


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


# Every request carries an optional `run_id` (a client-supplied idempotency key,
# stable across a run's run→select→approve steps) so the terminal result is
# logged to the `agent_run` console-history table under one stable id. `goal` on
# select/approve is the ORIGINAL goal, so the log keeps the human's words even
# on the steps that don't restate them. Both are optional: a caller that omits
# run_id (e.g. the CLI) still runs, we just mint an id and log it once.
class RunRequest(BaseModel):
    goal: str
    run_id: str | None = None


class ApproveRequest(BaseModel):
    cart_id: str
    run_id: str | None = None
    goal: str | None = None


class SelectRequest(BaseModel):
    item_id: str
    run_id: str | None = None
    goal: str | None = None


class CampaignResolveRequest(BaseModel):
    # The human's decision on a shown campaign offer.
    status: str  # "accepted" | "dismissed"


class UpsellRequest(BaseModel):
    # The originally chosen item (re-derived fresh, like SelectRequest.item_id).
    item_id: str
    accept: bool
    # Required only when accept=true — the exact item_id from the
    # upsell_suggestion the human was shown (never re-searched).
    addon_item_id: str | None = None
    # The UPSELL result's own cart_id (the already-composed base cart). On
    # decline, that cart is checked out as-is instead of being rebuilt from
    # scratch — avoids a confusing duplicate cart_built audit entry.
    cart_id: str | None = None
    run_id: str | None = None
    goal: str | None = None


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
        "amount_paise": result.amount_paise,
        "cart": result.cart,
        "upsell_suggestion": result.upsell_suggestion,
        "trace_id": trace_id,
        "llm_calls": orch.llm.calls,
    }


def _record_run(session_id: str, run_id: str | None, goal: str | None, rj: dict) -> None:
    """Log the terminal result to the console-history table. Best-effort: a
    logging failure must NEVER break the user's actual run, so any error is
    swallowed with a warning. `goal` falls back to the mandate's nl_goal when a
    step didn't restate it; `run_id` is minted when absent so every API run is
    still logged exactly once."""
    try:
        rid = run_id or f"run_{uuid.uuid4()}"
        text = goal or rj.get("message") or "(run)"
        _state["db"].record_run(rid, session_id, text, rj)
    except Exception:  # noqa: BLE001
        logger.warning("record_run failed for session %s (non-fatal)", session_id, exc_info=True)


def _narrate_async(session_id: str) -> None:
    """Fire-and-forget: narrate this session's not-yet-narrated audit entries
    (the ones this step's checkout/gate call just appended) in a background
    thread, so a Gemini call never adds latency to the user-facing purchase
    response. Best-effort — `Narrator.narrate_entry` already degrades to a
    deterministic sentence on its own when Gemini is unavailable, so this only
    guards against something unexpected (e.g. a DB hiccup)."""
    def _run() -> None:
        try:
            _state["narrator"].narrate_session(session_id)
        except Exception:  # noqa: BLE001
            logger.warning("narrate_async failed for session %s (non-fatal)", session_id, exc_info=True)

    threading.Thread(target=_run, daemon=True).start()


def _after_step(session_id: str, run_id: str | None, goal: str | None, rj: dict) -> None:
    """Everything that should follow an orchestrator step but must never delay
    or break the user-facing response: log it to the console-history table,
    and kick off background narration of whatever new audit entries this step
    just appended."""
    _record_run(session_id, run_id, goal, rj)
    _narrate_async(session_id)


def _sse_response(session_id: str, span_name: str, work, record=None):
    """Stream genuine pipeline-stage events over SSE while `work(orch, on_stage)`
    runs the (blocking) orchestrator in a worker thread. Each real stage
    start/finish is forwarded as `data: {"type":"stage",...}`; the terminal
    OrchestratorResult arrives as `data: {"type":"result",...}`. Callers must
    already have authenticated + checked ownership (so 401/403 return a normal
    HTTP status, not a stream)."""
    orch = _orchestrator()
    tracer = _state["tracer"]

    async def event_gen():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def on_stage(stage_id: str, status: str) -> None:
            loop.call_soon_threadsafe(
                queue.put_nowait, {"type": "stage", "id": stage_id, "status": status}
            )

        def run_work() -> None:
            try:
                with tracer.start_as_current_span(span_name) as span:
                    span.set_attribute("session_id", session_id)
                    result = work(orch, on_stage)
                    trace_id = format(span.get_span_context().trace_id, "032x")
                rj = _result_json(orch, result, trace_id)
                if record is not None:
                    record(rj)
                payload = {"type": "result", "result": rj}
            except LookupError as e:
                payload = {"type": "error", "detail": str(e)}
            except Exception as e:  # noqa: BLE001
                logger.exception("sse orchestrate failed")
                payload = {"type": "error", "detail": str(e)}
            loop.call_soon_threadsafe(queue.put_nowait, payload)
            loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

        fut = loop.run_in_executor(None, run_work)
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            await fut

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "paybound-agent-api"}


@app.get("/sessions/{session_id}/campaign")
def get_campaign_offer(session_id: str, authorization: str | None = Header(None)) -> dict:
    """The campaign orchestrator's at-most-one in-app nudge for this mandate,
    or `{"offer": null}`. A nudge only ever proposes a natural-language goal +
    reason — accepting it runs that goal through the ordinary, fully
    kernel-gated /run pipeline (see POST /sessions/{id}/campaign/{id}/resolve
    + the shop console). Evaluated fresh each call (cheap, no scheduler), with
    a once-per-24h frequency cap: an un-resolved offer keeps showing across
    reloads; after one is accepted/dismissed, no new nudge appears for 24h."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    store: CampaignStore = _state["campaign"]
    try:
        mandate = _state["db"].get_mandate_for_session(session_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    mandate_id = mandate["mandate_id"]

    # Cooldown / persistence: a still-'shown' offer keeps showing; any resolved
    # offer inside the 24h window suppresses a fresh one.
    recent = store.recent_offer(mandate_id)
    if recent is not None:
        return {"offer": recent if recent["status"] == "shown" else None}

    # Evaluate fresh. Reuse the orchestrator's already-wired cart_composer
    # (upsell + shared MiniLM embedder) — no LLM call happens in evaluate.
    try:
        orch = _orchestrator()
        engine = CampaignEngine(orch.cart_composer, _state["mcp"])
        running_spend = store.running_spend(session_id)
        runs = store.list_runs(mandate_id)
        dismissed = store.dismissed_item_ids(mandate_id)
        offer = engine.evaluate(mandate, running_spend, runs, datetime.now(UTC), dismissed)
    except Exception:  # noqa: BLE001 — a nudge is best-effort; never break the console
        logger.warning("campaign evaluate failed for session %s (non-fatal)", session_id, exc_info=True)
        return {"offer": None}

    if offer is None:
        return {"offer": None}
    try:
        return {"offer": store.insert_offer(mandate_id, offer)}
    except Exception:  # noqa: BLE001
        logger.warning("campaign insert failed for session %s (non-fatal)", session_id, exc_info=True)
        return {"offer": None}


@app.post("/sessions/{session_id}/campaign/{offer_id}/resolve")
def resolve_campaign_offer(
    session_id: str,
    offer_id: str,
    req: CampaignResolveRequest,
    authorization: str | None = Header(None),
) -> dict:
    """Record the human's accept/dismiss on a shown campaign offer. Accepting
    is a UI convenience only — the actual purchase is driven separately through
    /run — so this just logs the outcome."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    if req.status not in ("accepted", "dismissed"):
        raise HTTPException(status_code=400, detail="status must be 'accepted' or 'dismissed'")
    resolved = _state["campaign"].resolve_offer(offer_id, req.status)
    return {"resolved": resolved}


@app.post("/sessions/{session_id}/run/stream")
def run_session_stream(session_id: str, req: RunRequest, authorization: str | None = Header(None)):
    """SSE variant of /run — streams real pipeline-stage progress, then the
    final OrchestratorResult. Same auth + ownership rules as /run."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    return _sse_response(
        session_id,
        "purchase",
        lambda orch, on: orch.run(session_id, req.goal, on_stage=on),
        record=lambda rj: _after_step(session_id, req.run_id, req.goal, rj),
    )


@app.post("/sessions/{session_id}/select/stream")
def select_stream(session_id: str, req: SelectRequest, authorization: str | None = Header(None)):
    """SSE variant of /select — streams real stage progress, then the result."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    return _sse_response(
        session_id,
        "select",
        lambda orch, on: orch.select(session_id, req.item_id, on_stage=on),
        record=lambda rj: _after_step(session_id, req.run_id, req.goal, rj),
    )


@app.post("/sessions/{session_id}/upsell/stream")
def resolve_upsell_stream(session_id: str, req: UpsellRequest, authorization: str | None = Header(None)):
    """SSE variant of /upsell — streams real stage progress, then the result."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    return _sse_response(
        session_id,
        "upsell",
        lambda orch, on: orch.resolve_upsell(
            session_id, req.item_id, req.accept,
            addon_item_id=req.addon_item_id, cart_id=req.cart_id, on_stage=on,
        ),
        record=lambda rj: _after_step(session_id, req.run_id, req.goal, rj),
    )


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
    rj = _result_json(orch, result, trace_id)
    _after_step(session_id, req.run_id, req.goal, rj)
    return rj


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
    rj = _result_json(orch, result, trace_id)
    _after_step(session_id, req.run_id, req.goal, rj)
    return rj


@app.post("/sessions/{session_id}/upsell")
def resolve_upsell(session_id: str, req: UpsellRequest, authorization: str | None = Header(None)) -> dict:
    """Resume an UPSELL-paused session after the human accepted or declined
    the suggested complement (POST /sessions/{id}/run or /select returned
    state=UPSELL with an `upsell_suggestion`). No LLM call, and the confidence
    gate is skipped — it already passed before the suggestion was shown."""
    owner_hash = _authenticate(authorization)
    _require_session_owner(session_id, owner_hash)
    orch = _orchestrator()
    tracer = _state["tracer"]
    trace_id = None
    try:
        with tracer.start_as_current_span("upsell") as span:
            span.set_attribute("session_id", session_id)
            span.set_attribute("item_id", req.item_id)
            span.set_attribute("accept", req.accept)
            result = orch.resolve_upsell(
                session_id, req.item_id, req.accept,
                addon_item_id=req.addon_item_id, cart_id=req.cart_id,
            )
            trace_id = format(span.get_span_context().trace_id, "032x")
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("agent upsell resolution failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    rj = _result_json(orch, result, trace_id)
    _after_step(session_id, req.run_id, req.goal, rj)
    return rj


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
    rj = _result_json(orch, result, trace_id)
    _after_step(session_id, req.run_id, req.goal, rj)
    return rj
