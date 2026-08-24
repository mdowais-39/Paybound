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

    // Reuse a stable demo merchant across runs instead of minting a new one each
    // time: a fresh merchant per run left the catalog with dozens of duplicate
    // "Trail Running Shoe" rows across different merchant_ids, which crowded the
    // current run's own item out of search_catalog's top-N results (ties broke
    // arbitrarily against real ingested catalog items), intermittently making the
    // agent unable to find anything it should approve.
    let existing: Option<Uuid> =
        sqlx::query_scalar(
            "SELECT merchant_id FROM merchant WHERE name = 'Agent Demo Sports' \
             ORDER BY created_at LIMIT 1",
        )
            .fetch_optional(&pool)
            .await?;
    let merchant = match existing {
        Some(id) => {
            sqlx::query("DELETE FROM catalog_item WHERE merchant_id = $1")
                .bind(id)
                .execute(&pool)
                .await?;
            id
        }
        None => repos::create_merchant(&pool, "Agent Demo Sports", &json!(["upi"])).await?,
    };
    // Footwear (the primary goal) + socks (a complement the upsell model suggests).
    for (title, category, price) in [
        ("Trail Running Shoe", "footwear", 285_000i64),
        ("Road Runner Lite", "footwear", 210_000),
        ("Marathon Pro Premium Running Shoe", "footwear", 540_000),
        ("Cushioned Ankle Socks (3-pack)", "socks", 45_000),
        ("Compression Running Socks", "socks", 60_000),
    ] {
        sqlx::query(
            "INSERT INTO catalog_item (merchant_id, title, category, price_paise, variants)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(merchant)
        .bind(title)
        .bind(category)
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
        500_000, // budget ₹5,000 (headroom for a suggested complement)
        500_000, // per-txn ₹5,000
        vec!["footwear".into(), "socks".into()],
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
