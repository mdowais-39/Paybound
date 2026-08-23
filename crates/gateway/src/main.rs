//! Paybound gateway binary: wires the real Razorpay client + execution plane
//! into the router and serves it.

use common::{config::Config, telemetry};
use execution::{ExecConfig, ExecutionPlane};
use gateway::{build_router, AppState};
use razorpay_client::RazorpayClient;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::load().unwrap_or_else(|e| {
        eprintln!("config load failed ({e}); using defaults");
        serde_json::from_value(serde_json::json!({})).expect("default config")
    });
    let _telemetry = telemetry::init(&config.service_name, &config.otlp_endpoint);

    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&config.database_url)
        .await?;

    let key_id = std::env::var("RAZORPAY_KEY_ID").unwrap_or_default();
    let key_secret = std::env::var("RAZORPAY_KEY_SECRET").unwrap_or_default();
    let webhook_secret = std::env::var("RAZORPAY_WEBHOOK_SECRET").unwrap_or_default();
    if key_id.is_empty() {
        tracing::warn!(
            "RAZORPAY_KEY_ID not set — payment authorization will fail until configured"
        );
    }

    let client = RazorpayClient::new(key_id, key_secret);
    let exec = ExecutionPlane::new(pool, client, ExecConfig::default());

    let state = AppState {
        exec: Arc::new(exec),
        webhook_secret: Arc::new(webhook_secret),
    };

    let app = build_router(state);
    let addr = format!("0.0.0.0:{}", config.gateway_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "gateway listening");
    axum::serve(listener, app).await?;
    Ok(())
}
