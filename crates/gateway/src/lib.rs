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
use std::sync::Mutex;
use std::time::Instant;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

/// A tiny token-bucket rate limiter (no external deps). Refills continuously;
/// requests over the rate get 429. Applied globally to the gateway.
struct TokenBucket {
    tokens: f64,
    capacity: f64,
    refill_per_sec: f64,
    last: Instant,
}

impl TokenBucket {
    fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            tokens: capacity,
            capacity,
            refill_per_sec,
            last: Instant::now(),
        }
    }
    fn try_take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens
            + now.duration_since(self.last).as_secs_f64() * self.refill_per_sec)
            .min(self.capacity);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

async fn rate_limit(
    axum::extract::State(bucket): axum::extract::State<Arc<Mutex<TokenBucket>>>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if bucket.lock().unwrap().try_take() {
        next.run(req).await
    } else {
        (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response()
    }
}

/// Shared state: the execution plane, the DB pool, and the webhook secret.
#[derive(Clone)]
pub struct AppState {
    pub exec: Arc<ExecutionPlane>,
    pub pool: Db,
    pub webhook_secret: Arc<String>,
}

/// Build the gateway router (with a global token-bucket rate limit).
pub fn build_router(state: AppState) -> Router {
    // 200 req burst, refilling 200/s — a real limit that never bites a demo.
    let bucket = Arc::new(Mutex::new(TokenBucket::new(200.0, 200.0)));
    Router::new()
        .route("/health", get(health))
        .route("/webhooks/razorpay", post(razorpay_webhook))
        .route("/sessions/{session_id}/audit", get(audit_chain))
        .route("/mandates/{mandate_id}/revoke", post(revoke_mandate))
        .layer(axum::middleware::from_fn_with_state(bucket, rate_limit))
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

/// Instant revocation: the human kills a mandate's authority. The very next
/// agent purchase against it is refused by the kernel (`mandate_revoked`).
#[tracing::instrument(name = "revoke_mandate", level = "info", skip(s))]
async fn revoke_mandate(
    State(s): State<AppState>,
    Path(mandate_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, String)> {
    ledger::repos::revoke_mandate(&s.pool, mandate_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "mandate_id": mandate_id, "revoked": true })))
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

    // Replay protection: record each delivered body once. A duplicate/replayed
    // delivery conflicts on the SHA-256 PK and is acknowledged without re-processing.
    let body_hash = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(&body));
    let first_delivery = sqlx::query_scalar!(
        "INSERT INTO webhook_event (body_sha256, event_type) VALUES ($1, $2)
         ON CONFLICT (body_sha256) DO NOTHING RETURNING body_sha256",
        body_hash,
        event_type
    )
    .fetch_optional(&s.pool)
    .await
    .unwrap_or(None)
    .is_some();
    if !first_delivery {
        tracing::warn!(event_type, "duplicate/replayed webhook ignored");
        return StatusCode::OK;
    }

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
