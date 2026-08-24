//! Walking skeleton — the Phase 5 milestone. One command runs a single
//! hardcoded happy-path purchase through the ENTIRE spine end to end:
//!
//!   signed Intent Mandate -> storefront create_cart -> checkout (kernel gate)
//!   -> execution (real Razorpay test-mode payment link) -> (webhook receipt)
//!   -> session COMPLETED -> the complete, hash-verified audit chain.
//!
//! The only "stub" is the caller standing in for the not-yet-built agent and
//! the webhook receipt (invoked directly, exactly as the verified webhook
//! handler would). Everything on the money path is real.
//!
//! Run: DATABASE_URL=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... \
//!      cargo run -p harness --bin walking-skeleton

use common::signing::generate_keypair;
use domain::{money::format_rupees, AuditEventType, IntentMandate};
use execution::{ExecConfig, ExecutionPlane};
use kernel::Authorization;
use ledger::repos::{self, NewIntentMandate};
use ledger::AuditLedger;
use razorpay_client::RazorpayClient;
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use storefront_mcp::{CartItemReq, Storefront};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

type BoxErr = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> Result<(), BoxErr> {
    let db = std::env::var("DATABASE_URL").expect("set DATABASE_URL");
    let key_id = std::env::var("RAZORPAY_KEY_ID").expect("set RAZORPAY_KEY_ID");
    let key_secret = std::env::var("RAZORPAY_KEY_SECRET").expect("set RAZORPAY_KEY_SECRET");

    let pool = PgPoolOptions::new().connect(&db).await?;
    let store = Storefront::new(pool.clone());
    let exec = ExecutionPlane::new(
        pool.clone(),
        std::sync::Arc::new(RazorpayClient::new(key_id, key_secret)),
        ExecConfig::default(),
    );
    let ledger = AuditLedger::new(&pool);

    banner("PAYBOUND WALKING SKELETON — one purchase, end to end, on real test-mode rails");

    // --- 1. Merchant + catalog (a real product to shop) ----------------------
    let merchant = repos::create_merchant(&pool, "Skeleton Sports", &json!(["upi"])).await?;
    let item: Uuid = sqlx::query_scalar(
        "INSERT INTO catalog_item (merchant_id, title, category, price_paise, variants)
         VALUES ($1, 'Trail Running Shoe', 'footwear', 285000, $2) RETURNING item_id",
    )
    .bind(merchant)
    .bind(json!([{ "sku": "trs-9", "color": "black", "size": "9", "price_paise": 285000 }]))
    .fetch_one(&pool)
    .await?;
    step(
        1,
        "Catalog",
        &format!(
            "merchant + 1 item ('Trail Running Shoe', {})",
            format_rupees(285_000)
        ),
    );

    // --- 2. Human delegates: a signed Intent Mandate + a bound session --------
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
    ledger
        .append(
            session,
            AuditEventType::SessionCreated,
            json!({ "payer": mandate.payer, "nl_goal": mandate.nl_goal }),
        )
        .await?;
    step(
        2,
        "Delegate",
        &format!(
            "signed Intent Mandate (budget {}, footwear, TTL 1h); session {}",
            format_rupees(300_000),
            short(session)
        ),
    );

    // --- 3. Agent shops: build a cart via the storefront ---------------------
    let cart = store
        .create_cart(
            session,
            &[CartItemReq {
                item_id: item,
                qty: 1,
            }],
        )
        .await?;
    step(
        3,
        "Shop",
        &format!(
            "cart {} total {}",
            short(cart.cart_id),
            format_rupees(cart.total_paise)
        ),
    );

    // --- 4. Gate: checkout submits the cart to the kernel --------------------
    let decision = store.checkout(session, cart.cart_id, false).await?;
    step(
        4,
        "Gate",
        &format!(
            "kernel verdict: {} (rule: {:?})",
            decision.verdict.to_uppercase(),
            decision.rule_cited
        ),
    );
    if decision.verdict != "approved" {
        return Err(format!("expected approval, got {}", decision.verdict).into());
    }

    // --- 5. Pay: execution issues a token + a REAL Razorpay payment link -----
    let mandate_id = repos::get_session(&pool, session).await?.mandate_id;
    let auth = Authorization {
        mandate_id,
        cart_hash: decision.cart_hash.clone(),
        amount_paise: decision.amount_paise,
    };
    let authd = exec.authorize(session, &auth).await?;
    step(
        5,
        "Pay",
        &format!(
            "delegated token issued; REAL payment link {} -> {}",
            authd.razorpay_ref, authd.short_url
        ),
    );

    // --- 6. Webhook receipt: payment_link.paid (invoked as the verified
    //        handler would; in the live venue the real webhook fires) ---------
    exec.on_payment_paid(&authd.razorpay_ref).await?;
    step(
        6,
        "Complete",
        "payment_link.paid received -> session COMPLETED",
    );

    // --- 7. Prove: render + verify the hash-chained audit trail --------------
    println!();
    banner("AUDIT CHAIN (hash-linked, tamper-evident)");
    let chain = ledger.list_chain(session).await?;
    for e in &chain {
        println!(
            "  #{:<2} {:<16} hash={}… prev={}",
            e.seq,
            e.event_type,
            &e.this_hash[..12],
            e.prev_hash
                .as_deref()
                .map(|h| &h[..12])
                .unwrap_or("—(genesis)")
        );
    }
    let ok = ledger.verify_chain(session).await?;
    println!();
    println!(
        "  verify_chain() = {}",
        if ok {
            "PASS ✓  (every rupee provably authorized)"
        } else {
            "FAIL ✗"
        }
    );
    if !ok {
        return Err("audit chain failed verification".into());
    }

    println!();
    banner("WALKING SKELETON COMPLETE — demoable from here on");
    println!("  Pay the link above with UPI 'success@razorpay' to see the REAL payment in the dashboard.");
    Ok(())
}

fn banner(s: &str) {
    println!("\n=== {s} ===");
}
fn step(n: u8, label: &str, detail: &str) {
    println!("  [{n}] {label:<9} {detail}");
}
fn short(id: Uuid) -> String {
    id.to_string()[..8].to_string()
}
