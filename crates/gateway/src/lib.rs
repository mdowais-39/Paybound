//! Gateway: public API + Razorpay webhook receiver. The router is built here
//! (generic over the payment gateway) so the webhook receiver is testable with
//! a fake execution plane.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use execution::ExecutionPlane;
use ledger::{AuditLedger, Db};
use razorpay_client::verify_webhook_signature;
use serde_json::{json, Value};
use std::sync::Arc;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

/// Shared state: the execution plane, the DB pool, and the webhook secret.
#[derive(Clone)]
pub struct AppState {
    pub exec: Arc<ExecutionPlane>,
    pub pool: Db,
    pub webhook_secret: Arc<String>,
}

/// Build the gateway router.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/webhooks/razorpay", post(razorpay_webhook))
        .route("/sessions/{session_id}/audit", get(audit_chain))
        .with_state(state)
}

/// Return a session's full narrated, hash-chained audit trail plus the
/// tamper-evidence verdict. This is the read surface the frontend audit viewer
/// consumes — the "why every rupee moved" artifact.
#[tracing::instrument(name = "audit_chain", level = "info", skip(s))]
async fn audit_chain(
    State(s): State<AppState>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let ledger = AuditLedger::new(&s.pool);
    let chain = ledger
        .list_chain(session_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let verified = ledger
        .verify_chain(session_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let entries: Vec<Value> = chain
        .iter()
        .map(|e| {
            json!({
                "seq": e.seq,
                "event_type": e.event_type,
                "prev_hash": e.prev_hash,
                "this_hash": e.this_hash,
                "payload": e.payload,
                "narrative": e.narrative,
                "ts": e.ts.format(&Rfc3339).unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({
        "session_id": session_id,
        "verified": verified,
        "entry_count": entries.len(),
        "entries": entries,
    })))
}

#[tracing::instrument(name = "health", level = "info")]
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "paybound-gateway" }))
}

/// Razorpay webhook receiver. Verifies the HMAC signature over the RAW body
/// (never re-serialized), then dispatches paid/failed to the execution plane.
/// The handlers are idempotent, so a redelivered event is safe.
#[tracing::instrument(name = "razorpay_webhook", level = "info", skip_all)]
async fn razorpay_webhook(
    State(s): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    let signature = headers
        .get("X-Razorpay-Signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !verify_webhook_signature(&s.webhook_secret, &body, signature) {
        tracing::warn!("rejected webhook with invalid signature");
        return StatusCode::UNAUTHORIZED;
    }

    let event: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    let event_type = event.get("event").and_then(|e| e.as_str()).unwrap_or("");
    let plink_id = event
        .pointer("/payload/payment_link/entity/id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if plink_id.is_empty() {
        tracing::warn!(event_type, "webhook missing payment_link id; ignoring");
        return StatusCode::OK;
    }

    let result = match event_type {
        "payment_link.paid" => s.exec.on_payment_paid(plink_id).await,
        "payment_link.cancelled" | "payment_link.expired" | "payment.failed" => {
            s.exec.on_payment_failed(plink_id).await
        }
        other => {
            tracing::info!(event = other, "unhandled webhook event; acknowledging");
            Ok(false)
        }
    };

    match result {
        Ok(_) => StatusCode::OK,
        Err(e) => {
            tracing::error!(error = %e, "webhook handling failed");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
