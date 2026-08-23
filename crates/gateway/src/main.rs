//! Paybound gateway: public API + Razorpay webhook receiver.
//!
//! Phase 0 exposes only `/health` with tracing middleware, to prove the
//! service boots, binds, and emits a span per request. The webhook receiver
//! and the audit read-API land in Phases 4 and 9.

use axum::{routing::get, Json, Router};
use common::{config::Config, telemetry};
use serde_json::{json, Value};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::load().unwrap_or_else(|e| {
        eprintln!("config load failed ({e}); using defaults");
        // Fall back to defaults so `/health` works even before `.env` exists.
        serde_json::from_value(json!({})).expect("default config")
    });

    // Keep the guard alive for the process lifetime so spans flush on exit.
    let _telemetry = telemetry::init(&config.service_name, &config.otlp_endpoint);

    let app = Router::new()
        .route("/health", get(health))
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{}", config.gateway_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "gateway listening");

    axum::serve(listener, app).await?;
    Ok(())
}

/// Liveness probe. Returns 200 with a small JSON body and produces a trace span
/// via the `TraceLayer` middleware.
async fn health() -> Json<Value> {
    tracing::info!("health check");
    Json(json!({ "status": "ok", "service": "paybound-gateway" }))
}
