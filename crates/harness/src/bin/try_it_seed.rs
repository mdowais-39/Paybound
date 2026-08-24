//! Seed a session for interactive, free-form testing: a signed Intent Mandate
//! authorized across the ENTIRE real ingested catalog (Paybound Demo Store —
//! phone cases, shoes, furniture, grocery, ...), not just a handful of
//! hardcoded demo items. Lets a real person type any shopping request and see
//! the whole pipeline (LLM parse -> search -> kernel gate -> payment) respond
//! to it honestly, rather than to a scripted goal.
//!
//! Budget/cap are overridable via env so you can widen or tighten the bounds
//! between tries: TRY_IT_BUDGET_PAISE (default 1,000,000 = ₹10,000),
//! TRY_IT_PER_TXN_CAP_PAISE (default 600,000 = ₹6,000).
//!
//! Run: DATABASE_URL=... cargo run -p harness --bin try_it_seed

use common::signing::generate_keypair;
use domain::{AuditEventType, IntentMandate};
use ledger::repos::{self, NewIntentMandate};
use ledger::AuditLedger;
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = std::env::var("DATABASE_URL").expect("set DATABASE_URL");
    let pool = PgPoolOptions::new().connect(&db).await?;

    let merchant: Uuid =
        sqlx::query_scalar("SELECT merchant_id FROM merchant WHERE name = 'Paybound Demo Store'")
            .fetch_one(&pool)
            .await
            .map_err(|e| {
                format!("Paybound Demo Store not found (run data/ingest_abo.py first): {e}")
            })?;

    let categories: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT category FROM catalog_item WHERE merchant_id = $1")
            .bind(merchant)
            .fetch_all(&pool)
            .await?;

    let budget: i64 = std::env::var("TRY_IT_BUDGET_PAISE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1_000_000); // ₹10,000
    let per_txn_cap: i64 = std::env::var("TRY_IT_PER_TXN_CAP_PAISE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(600_000); // ₹6,000

    let key = generate_keypair();
    let mandate = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        budget,
        per_txn_cap,
        categories,
        vec![merchant],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "shop the demo store within budget",
    );
    let mandate_id = repos::create_intent_mandate(
        &pool,
        NewIntentMandate {
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
        },
    )
    .await?;
    let session = repos::create_session(&pool, mandate_id).await?;
    AuditLedger::new(&pool)
        .append(
            session,
            AuditEventType::SessionCreated,
            json!({ "payer": mandate.payer, "nl_goal": mandate.nl_goal }),
        )
        .await?;

    println!("SESSION={session}");
    println!("BUDGET_PAISE={budget}");
    println!("PER_TXN_CAP_PAISE={per_txn_cap}");
    Ok(())
}
