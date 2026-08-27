//! Gateway: public API + Razorpay webhook receiver. The router is built here
//! (generic over the payment gateway) so the webhook receiver is testable with
//! a fake execution plane.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use domain::{AuditEventType, IntentMandate};
use execution::ExecutionPlane;
use ledger::{repos, AuditLedger, Db};
use razorpay_client::verify_webhook_signature;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use tower_http::cors::{Any, CorsLayer};
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
    // Permissive CORS: this gateway serves only test-mode, non-sensitive demo
    // data (no auth, no PII) to a frontend that may run on any local port.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);
    Router::new()
        .route("/health", get(health))
        .route("/webhooks/razorpay", post(razorpay_webhook))
        .route("/sessions/{session_id}/audit", get(audit_chain))
        .route("/sessions/{session_id}", get(get_session))
        .route("/mandates", post(create_mandate).get(list_mandates))
        .route("/mandates/{mandate_id}/revoke", post(revoke_mandate))
        .route("/catalog/categories", get(list_categories))
        .route("/identity", post(create_identity))
        .layer(cors)
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
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let owner_hash = authenticate(&s, &headers).await?;
    require_session_owner(&s, session_id, &owner_hash).await?;
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
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let owner_hash = authenticate(&s, &headers).await?;
    let owner = repos::get_mandate_owner(&s.pool, mandate_id)
        .await
        .map_err(|e| match e {
            common::AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            other => internal(other),
        })?;
    if matches!(&owner, Some(h) if h != &owner_hash) {
        return Err(forbidden("not your mandate"));
    }
    ledger::repos::revoke_mandate(&s.pool, mandate_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "mandate_id": mandate_id, "revoked": true })))
}

/// Shared ownership check for session-scoped endpoints (audit, get). A
/// session created before identity existed (`owner_token_hash IS NULL`) has
/// no owner to check against, so it stays openly readable — only sessions
/// created through the (now always-authenticated) `POST /mandates` are
/// actually protected. 404 if the session doesn't exist, 403 if it has an
/// owner and it isn't the caller.
async fn require_session_owner(
    s: &AppState,
    session_id: Uuid,
    owner_hash: &str,
) -> Result<(), (StatusCode, String)> {
    let owner = repos::get_session_owner(&s.pool, session_id)
        .await
        .map_err(|e| match e {
            common::AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            other => internal(other),
        })?;
    if matches!(&owner, Some(h) if h != owner_hash) {
        return Err(forbidden("not your session"));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CreateMandateReq {
    #[serde(default = "default_payer")]
    pub payer: String,
    pub budget_total_paise: i64,
    pub per_txn_cap_paise: i64,
    /// Omit to authorize every category the target merchant sells.
    pub allowed_categories: Option<Vec<String>>,
    /// Omit to scope to the default demo merchant.
    pub merchant_id: Option<Uuid>,
    #[serde(default = "default_ttl_seconds")]
    pub ttl_seconds: i64,
    #[serde(default = "default_nl_goal")]
    pub nl_goal: String,
}
fn default_payer() -> String {
    "customer".to_string()
}
fn default_ttl_seconds() -> i64 {
    3600
}
fn default_nl_goal() -> String {
    "shop within budget".to_string()
}

fn bad_request(msg: impl Into<String>) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, msg.into())
}
fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
fn unauthorized(msg: impl Into<String>) -> (StatusCode, String) {
    (StatusCode::UNAUTHORIZED, msg.into())
}
fn forbidden(msg: impl Into<String>) -> (StatusCode, String) {
    (StatusCode::FORBIDDEN, msg.into())
}

fn hash_token(token: &str) -> String {
    hex::encode(<sha2::Sha256 as sha2::Digest>::digest(token.as_bytes()))
}

/// Pull `Authorization: Bearer <token>` and verify it against a known
/// identity, returning the token's hash — the value ownership is compared
/// against everywhere below. 401 if missing, malformed, or unrecognized.
async fn authenticate(s: &AppState, headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let raw = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| unauthorized("missing Authorization: Bearer <token>"))?;
    let hash = hash_token(raw);
    if !repos::identity_exists(&s.pool, &hash)
        .await
        .map_err(internal)?
    {
        return Err(unauthorized("unknown or invalid token"));
    }
    Ok(hash)
}

/// Mint a new identity. The raw token is returned exactly once and never
/// stored — only its SHA-256 hash is, so it can't be recovered from the DB.
/// No auth required (this IS how a caller gets a token in the first place).
#[tracing::instrument(name = "create_identity", level = "info", skip(s))]
async fn create_identity(State(s): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    let token = format!("pb_{}", Uuid::new_v4().simple());
    repos::create_identity(&s.pool, &hash_token(&token))
        .await
        .map_err(internal)?;
    Ok(Json(json!({ "token": token })))
}

/// Create a signed Intent Mandate + the one session bound to it, so a
/// customer can grant an agent bounded shopping authority from the frontend
/// (replaces the `try_it_seed` / `agent_demo_seed` dev binaries). Each goal
/// the customer later shops with runs against this SAME session, so
/// `running_spend_paise` correctly accumulates across every purchase made
/// under this mandate — not just the first.
#[tracing::instrument(name = "create_mandate", level = "info", skip(s, req))]
async fn create_mandate(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateMandateReq>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let owner_hash = authenticate(&s, &headers).await?;
    if req.budget_total_paise <= 0 || req.per_txn_cap_paise <= 0 {
        return Err(bad_request(
            "budget_total_paise and per_txn_cap_paise must be > 0",
        ));
    }
    if req.per_txn_cap_paise > req.budget_total_paise {
        return Err(bad_request(
            "per_txn_cap_paise cannot exceed budget_total_paise",
        ));
    }
    if req.ttl_seconds <= 0 {
        return Err(bad_request("ttl_seconds must be > 0"));
    }

    // Merchant scope. Omitting merchant_id means "shop the whole marketplace":
    // an EMPTY allowed_merchants list, which the kernel treats as unrestricted
    // on the merchant axis (the budget / per-txn cap / TTL still bind). This is
    // what a customer expects — searching "headphones" shouldn't silently find
    // nothing just because headphones live in a different sub-merchant than the
    // default store. Passing a specific merchant_id still scopes to it.
    let allowed_merchants: Vec<Uuid> = match req.merchant_id {
        Some(id) => vec![id],
        None => vec![],
    };
    // Category scope. Omitting categories (or []) means "any category" — again
    // an empty allow-list the kernel treats as unrestricted. We no longer
    // pre-fill the default merchant's categories, since a marketplace-wide
    // mandate has no single merchant to read them from.
    let allowed_categories = req.allowed_categories.unwrap_or_default();

    let key = common::signing::generate_keypair();
    let mandate = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        req.payer.as_str(),
        req.budget_total_paise,
        req.per_txn_cap_paise,
        allowed_categories.clone(),
        allowed_merchants,
        OffsetDateTime::now_utc() + Duration::seconds(req.ttl_seconds),
        req.nl_goal.as_str(),
    );
    let mandate_id = repos::create_intent_mandate(
        &s.pool,
        repos::NewIntentMandate {
            mandate_id: mandate.mandate_id,
            payer: &mandate.payer,
            budget_total_paise: mandate.budget_total_paise,
            per_txn_cap_paise: mandate.per_txn_cap_paise,
            allowed_categories: &json!(mandate.allowed_categories),
            allowed_merchants: &json!(mandate.allowed_merchants),
            ttl: mandate.ttl,
            nl_goal: &mandate.nl_goal,
            public_key: &mandate.public_key,
            signature: &mandate.signature,
            owner_token_hash: Some(&owner_hash),
        },
    )
    .await
    .map_err(internal)?;
    let session_id = repos::create_session(&s.pool, mandate_id)
        .await
        .map_err(internal)?;
    AuditLedger::new(&s.pool)
        .append(
            session_id,
            AuditEventType::SessionCreated,
            json!({ "payer": mandate.payer, "nl_goal": mandate.nl_goal }),
        )
        .await
        .map_err(internal)?;

    Ok(Json(json!({
        "mandate_id": mandate_id,
        "session_id": session_id,
        "payer": mandate.payer,
        "budget_total_paise": mandate.budget_total_paise,
        "per_txn_cap_paise": mandate.per_txn_cap_paise,
        "allowed_categories": mandate.allowed_categories,
        "allowed_merchants": mandate.allowed_merchants,
        "ttl_unix": mandate.ttl.unix_timestamp(),
        "nl_goal": mandate.nl_goal,
    })))
}

/// List mandates newest-first, each with its bound session's live state and
/// spend — feeds the Mandate Console's list + spend meters.
#[tracing::instrument(name = "list_mandates", level = "info", skip(s))]
async fn list_mandates(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let owner_hash = authenticate(&s, &headers).await?;
    let rows = repos::list_mandates(&s.pool, &owner_hash, 100)
        .await
        .map_err(internal)?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "mandate_id": r.mandate_id,
                "payer": r.payer,
                "budget_total_paise": r.budget_total_paise,
                "per_txn_cap_paise": r.per_txn_cap_paise,
                "allowed_categories": r.allowed_categories,
                "allowed_merchants": r.allowed_merchants,
                "ttl_unix": r.ttl.unix_timestamp(),
                "nl_goal": r.nl_goal,
                "revoked": r.revoked,
                "session_id": r.session_id,
                "session_state": r.session_state,
                "running_spend_paise": r.running_spend_paise.unwrap_or(0),
            })
        })
        .collect();
    Ok(Json(json!(out)))
}

/// A session's live state + spend + its mandate's bounds + its latest cart —
/// what the shop page polls while (or after) the agent runs.
#[tracing::instrument(name = "get_session", level = "info", skip(s))]
async fn get_session(
    State(s): State<AppState>,
    Path(session_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let owner_hash = authenticate(&s, &headers).await?;
    require_session_owner(&s, session_id, &owner_hash).await?;
    let r = repos::get_session_summary(&s.pool, session_id)
        .await
        .map_err(|e| match e {
            common::AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            other => internal(other),
        })?;
    Ok(Json(json!({
        "session_id": r.session_id,
        "mandate_id": r.mandate_id,
        "state": r.state,
        "running_spend_paise": r.running_spend_paise,
        "budget_total_paise": r.budget_total_paise,
        "per_txn_cap_paise": r.per_txn_cap_paise,
        "latest_cart_id": r.latest_cart_id,
    })))
}

#[derive(Debug, Deserialize)]
pub struct CategoriesQuery {
    pub merchant_id: Option<Uuid>,
}

/// Distinct catalog categories — feeds the mandate form's category picker.
/// With `?merchant_id=` it's that merchant's categories; without, it's every
/// category across the whole marketplace (matching the marketplace-wide
/// default mandate).
#[tracing::instrument(name = "list_categories", level = "info", skip(s))]
async fn list_categories(
    State(s): State<AppState>,
    Query(q): Query<CategoriesQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let cats = match q.merchant_id {
        Some(id) => repos::list_categories(&s.pool, id)
            .await
            .map_err(internal)?,
        None => repos::list_all_categories(&s.pool)
            .await
            .map_err(internal)?,
    };
    Ok(Json(json!(cats)))
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
