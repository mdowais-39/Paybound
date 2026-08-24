//! Seed a footwear merchant + items + a signed footwear Intent Mandate + a
//! session, so the Python agent can shop it. Prints `SESSION=<uuid>`.
//!
//! Run: DATABASE_URL=... cargo run -p harness --bin agent_demo_seed

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

    let merchant = repos::create_merchant(&pool, "Agent Demo Sports", &json!(["upi"])).await?;
    for (title, price) in [
        ("Trail Running Shoe", 285_000i64),
        ("Road Runner Lite", 210_000),
        ("Marathon Pro (premium)", 540_000),
    ] {
        sqlx::query(
            "INSERT INTO catalog_item (merchant_id, title, category, price_paise, variants)
             VALUES ($1, $2, 'footwear', $3, $4)",
        )
        .bind(merchant)
        .bind(title)
        .bind(price)
        .bind(json!([{ "sku": "s", "color": "black", "size": "9", "price_paise": price }]))
        .execute(&pool)
        .await?;
    }

    let key = generate_keypair();
    let mandate = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        300_000, // budget ₹3,000
        300_000, // per-txn ₹3,000
        vec!["footwear".into()],
        vec![merchant],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "buy running shoes under ₹3,000",
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
    Ok(())
}
