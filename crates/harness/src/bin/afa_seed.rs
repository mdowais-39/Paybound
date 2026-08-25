//! Seed an AFA scenario: a footwear mandate with a high per-txn cap (so only the
//! ₹15,000 AFA gate can trigger NEEDS_HUMAN) + a >₹15,000 item + a session.
//! Prints SESSION=<uuid> and ITEM=<uuid>.
//!
//! Run: DATABASE_URL=... cargo run -p harness --bin afa_seed

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

    let merchant = repos::create_merchant(&pool, "AFA Demo Store", &json!(["upi"])).await?;
    let item: Uuid = sqlx::query_scalar(
        "INSERT INTO catalog_item (merchant_id, title, category, price_paise, variants)
         VALUES ($1, 'Premium Carbon Marathon Shoe', 'footwear', 2000000, $2) RETURNING item_id",
    )
    .bind(merchant)
    .bind(json!([{ "sku": "pm-9", "color": "black", "size": "9", "price_paise": 2000000 }]))
    .fetch_one(&pool)
    .await?;

    let key = generate_keypair();
    let mandate = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        5_000_000, // budget ₹50,000
        5_000_000, // per-txn ₹50,000 (so only the ₹15k AFA gate fires)
        vec!["footwear".into()],
        vec![merchant],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "buy the premium marathon shoes",
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
            owner_token_hash: None,
        },
    )
    .await?;
    let session = repos::create_session(&pool, mandate_id).await?;
    AuditLedger::new(&pool)
        .append(
            session,
            AuditEventType::SessionCreated,
            json!({ "nl_goal": mandate.nl_goal }),
        )
        .await?;

    println!("SESSION={session}");
    println!("ITEM={item}");
    Ok(())
}
