//! Gateway: public API + Razorpay webhook receiver. The router is built here
//! (generic over the payment gateway) so the webhook receiver is testable with
//! a fake execution plane.

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use execution::ExecutionPlane;
use razorpay_client::{verify_webhook_signature, PaymentGateway};
use serde_json::{json, Value};
use std::sync::Arc;

/// Shared state: the execution plane + the webhook secret.
pub struct AppState<G: PaymentGateway> {
    pub exec: Arc<ExecutionPlane<G>>,
    pub webhook_secret: Arc<String>,
}

impl<G: PaymentGateway> Clone for AppState<G> {
    fn clone(&self) -> Self {
        Self {
            exec: self.exec.clone(),
            webhook_secret: self.webhook_secret.clone(),
        }
    }
}

/// Build the gateway router.
pub fn build_router<G: PaymentGateway + 'static>(state: AppState<G>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/webhooks/razorpay", post(razorpay_webhook::<G>))
        .with_state(state)
}

#[tracing::instrument(name = "health", level = "info")]
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "paybound-gateway" }))
}

/// Razorpay webhook receiver. Verifies the HMAC signature over the RAW body
/// (never re-serialized), then dispatches paid/failed to the execution plane.
/// The handlers are idempotent, so a redelivered event is safe.
#[tracing::instrument(name = "razorpay_webhook", level = "info", skip_all)]
async fn razorpay_webhook<G: PaymentGateway>(
    State(s): State<AppState<G>>,
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
