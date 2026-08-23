//! Drive the execution plane against the REAL Razorpay test API: seed a session,
//! authorize a small purchase, and print the real payable payment-link URL.
//! Runs authorize twice to demonstrate idempotency (no double charge).
//!
//! Run: DATABASE_URL=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... \
//!      cargo run -p execution --example live_authorize

use execution::{ExecConfig, ExecutionPlane};
use kernel::Authorization;
use ledger::repos::{self, NewIntentMandate};
use razorpay_client::RazorpayClient;
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let key_id = std::env::var("RAZORPAY_KEY_ID").expect("RAZORPAY_KEY_ID");
    let key_secret = std::env::var("RAZORPAY_KEY_SECRET").expect("RAZORPAY_KEY_SECRET");

    let pool = PgPoolOptions::new().connect(&db).await?;
    let client = RazorpayClient::new(key_id, key_secret);
    let exec = ExecutionPlane::new(pool.clone(), client, ExecConfig::default());

    // Seed a session + mandate.
    let merchant = repos::create_merchant(&pool, "Paybound Live Demo", &json!(["upi"])).await?;
    let mandate_id = Uuid::new_v4();
    repos::create_intent_mandate(
        &pool,
        NewIntentMandate {
            mandate_id,
            payer: "user_owais",
            budget_total_paise: 5_000_000,
            per_txn_cap_paise: 500_000,
            allowed_categories: &json!(["footwear"]),
            allowed_merchants: &json!([merchant]),
            ttl: OffsetDateTime::now_utc() + Duration::hours(1),
            nl_goal: "live demo purchase",
            public_key: "deadbeef",
            signature: "cafebabe",
        },
    )
    .await?;
    let session = repos::create_session(&pool, mandate_id).await?;

    let auth = Authorization {
        mandate_id,
        cart_hash: format!("live-{}", Uuid::new_v4()),
        amount_paise: 50_800, // ₹508
    };

    println!("== authorize (1st call) ==");
    let r1 = exec.authorize(session, &auth).await?;
    println!("  razorpay_ref : {}", r1.razorpay_ref);
    println!("  payable URL  : {}", r1.short_url);
    println!("  deduplicated : {}", r1.deduplicated);

    println!("== authorize (2nd call, same cart → idempotent) ==");
    let r2 = exec.authorize(session, &auth).await?;
    println!("  razorpay_ref : {}", r2.razorpay_ref);
    println!("  deduplicated : {}", r2.deduplicated);
    assert_eq!(r1.payment_effect_id, r2.payment_effect_id);
    assert_eq!(r1.razorpay_ref, r2.razorpay_ref);
    println!("  -> same payment_effect, same link: NO double charge.");
    Ok(())
}
