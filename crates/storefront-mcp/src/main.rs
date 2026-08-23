//! The MCP storefront server: the MCP JSON-RPC endpoint plus the agent-discovery
//! surface (agents.txt, ARD manifest, product feed, schema.org JSON-LD).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use common::{config::Config, telemetry};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use storefront_mcp::{discovery, mcp, Storefront};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    store: Storefront,
    base_url: Arc<String>,
    pool: ledger::Db,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::load().unwrap_or_else(|e| {
        eprintln!("config load failed ({e}); using defaults");
        serde_json::from_value(serde_json::json!({})).expect("default config")
    });
    let _telemetry = telemetry::init("paybound-storefront", &config.otlp_endpoint);

    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&config.database_url)
        .await?;

    let port: u16 = std::env::var("PAYBOUND_STOREFRONT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8081);
    let base_url = format!("http://localhost:{port}");

    let state = AppState {
        store: Storefront::new(pool.clone()),
        base_url: Arc::new(base_url),
        pool,
    };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/mcp", post(mcp_endpoint))
        .route("/.well-known/agents.txt", get(agents_txt))
        .route("/.well-known/ard.json", get(ard_manifest))
        .route("/feed.json", get(feed))
        .route("/schema/{item_id}", get(schema))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "storefront-mcp listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[tracing::instrument(name = "mcp", level = "info", skip_all)]
async fn mcp_endpoint(State(s): State<AppState>, Json(req): Json<Value>) -> Json<Value> {
    Json(mcp::handle(&s.store, &req).await)
}

async fn agents_txt(State(s): State<AppState>) -> impl IntoResponse {
    discovery::agents_txt(&s.base_url)
}

async fn ard_manifest(State(s): State<AppState>) -> Json<Value> {
    Json(discovery::ard_manifest(&s.base_url))
}

async fn feed(State(s): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    discovery::product_feed(&s.pool)
        .await
        .map(Json)
        .map_err(internal)
}

async fn schema(
    State(s): State<AppState>,
    Path(item_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, String)> {
    discovery::product_jsonld(&s.pool, item_id)
        .await
        .map(Json)
        .map_err(internal)
}

fn internal(e: common::AppError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
