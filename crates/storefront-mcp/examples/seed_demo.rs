//! Seed a signed Intent Mandate + a bound session against the real catalog, so
//! the storefront's create_cart/checkout tools can be exercised over HTTP (and
//! for the Phase 5 walking skeleton). Prints machine-parseable KEY=value lines.
//!
//! Run: DATABASE_URL=... cargo run -p storefront-mcp --example seed_demo

use domain::IntentMandate;
use ledger::repos::{self, NewIntentMandate};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let db_url = std::env::var("DATABASE_URL")
        .or_else(|_| std::env::var("PAYBOUND_DATABASE_URL"))
        .expect("set DATABASE_URL");
    let pool = PgPoolOptions::new().connect(&db_url).await?;

    // The demo merchant from ingestion.
    let merchant: Uuid =
        sqlx::query_scalar("SELECT merchant_id FROM merchant WHERE name = 'Paybound Demo Store'")
            .fetch_one(&pool)
            .await?;

    // Pick the cheapest item in the most-populated category (a clean approve).
    let row = sqlx::query_as::<_, (Uuid, String, i64)>(
        "SELECT item_id, category, price_paise FROM catalog_item
         WHERE merchant_id = $1
           AND category = (
             SELECT category FROM catalog_item WHERE merchant_id = $1
             GROUP BY category ORDER BY count(*) DESC LIMIT 1)
         ORDER BY price_paise ASC LIMIT 1",
    )
    .bind(merchant)
    .fetch_one(&pool)
    .await?;
    let (item_id, category, price) = row;

    // A signed mandate authorizing that category + merchant; ₹50,000 budget,
    // ₹5,000 per-transaction cap (so the cheap item approves).
    let key = common::signing::generate_keypair();
    let m = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        5_000_000,
        500_000,
        vec![category.clone()],
        vec![merchant],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "demo: buy one affordable item",
    );
    let mandate_id = repos::create_intent_mandate(
        &pool,
        NewIntentMandate {
            mandate_id: m.mandate_id,
            payer: &m.payer,
            budget_total_paise: m.budget_total_paise,
            per_txn_cap_paise: m.per_txn_cap_paise,
            allowed_categories: &json!(m.allowed_categories),
            allowed_merchants: &json!(m.allowed_merchants),
            ttl: m.ttl,
            nl_goal: &m.nl_goal,
            public_key: &m.public_key,
            signature: &m.signature,
        },
    )
    .await?;
    let session_id = repos::create_session(&pool, mandate_id).await?;

    println!("SESSION={session_id}");
    println!("MANDATE={mandate_id}");
    println!("ITEM={item_id}");
    println!("CATEGORY={category}");
    println!("PRICE={price}");
    Ok(())
}
