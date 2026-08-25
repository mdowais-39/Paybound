//! Integration tests for the storefront tools, including the architectural
//! heart: `checkout` routes to the kernel and returns an approval or a typed
//! refusal — it never pays.

use common::signing::generate_keypair;
use domain::IntentMandate;
use ledger::repos::{self, NewIntentMandate};
use serde_json::json;
use sqlx::PgPool;
use storefront_mcp::{CartItemReq, Storefront};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

/// Seed a merchant + two footwear items and return (merchant_id, cheap, pricey).
async fn seed_catalog(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let merchant = repos::create_merchant(pool, "Acme Sports", &json!(["upi"]))
        .await
        .unwrap();
    let cheap = insert_item(pool, merchant, "Trail Runner Shoe", "footwear", 150_000).await;
    let pricey = insert_item(pool, merchant, "Premium Marathon Shoe", "footwear", 285_000).await;
    (merchant, cheap, pricey)
}

async fn insert_item(pool: &PgPool, merchant: Uuid, title: &str, cat: &str, price: i64) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO catalog_item (merchant_id, title, category, price_paise, variants)
         VALUES ($1,$2,$3,$4,$5) RETURNING item_id",
    )
    .bind(merchant)
    .bind(title)
    .bind(cat)
    .bind(price)
    .bind(json!([{ "sku": "s-1", "color": "black", "size": "9", "price_paise": price }]))
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A signed footwear mandate + a session bound to it. `per_txn_cap`/`budget` vary.
async fn seed_session(pool: &PgPool, merchant: Uuid, per_txn: i64, budget: i64) -> Uuid {
    let key = generate_keypair();
    let m = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        budget,
        per_txn,
        vec!["footwear".into()],
        vec![merchant],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "buy running shoes",
    );
    let mandate_id = repos::create_intent_mandate(
        pool,
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
            owner_token_hash: None,
        },
    )
    .await
    .unwrap();
    repos::create_session(pool, mandate_id).await.unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn search_availability_variants(pool: PgPool) {
    let (_m, cheap, _pricey) = seed_catalog(&pool).await;
    let store = Storefront::new(pool.clone());

    let results = store.search_catalog("shoe", 10).await.unwrap();
    assert!(results.len() >= 2, "search should find the seeded shoes");
    assert!(results.iter().all(|r| r.category == "footwear"));

    let avail = store.get_availability(cheap).await.unwrap();
    assert!(avail.available);
    assert_eq!(avail.price_paise, 150_000);

    let variants = store.get_variants(cheap).await.unwrap();
    assert!(variants.variants.as_array().is_some());
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_in_budget_is_approved(pool: PgPool) {
    let (merchant, cheap, _pricey) = seed_catalog(&pool).await;
    let session = seed_session(&pool, merchant, 300_000, 300_000).await;
    let store = Storefront::new(pool.clone());

    let cart = store
        .create_cart(
            session,
            &[CartItemReq {
                item_id: cheap,
                qty: 1,
            }],
        )
        .await
        .unwrap();
    assert_eq!(cart.total_paise, 150_000);

    let result = store.checkout(session, cart.cart_id, false).await.unwrap();
    assert_eq!(result.verdict, "approved");
    assert!(result.rule_cited.is_none());

    // The session advanced to AUTHORIZED and a gate decision was recorded.
    assert_eq!(
        repos::get_session_state(&pool, session).await.unwrap(),
        "AUTHORIZED"
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_over_cap_is_refused_by_kernel(pool: PgPool) {
    let (merchant, _cheap, pricey) = seed_catalog(&pool).await;
    // per-txn cap ₹2,000 — the ₹2,850 item breaches it.
    let session = seed_session(&pool, merchant, 200_000, 1_000_000).await;
    let store = Storefront::new(pool.clone());

    let cart = store
        .create_cart(
            session,
            &[CartItemReq {
                item_id: pricey,
                qty: 1,
            }],
        )
        .await
        .unwrap();

    let result = store.checkout(session, cart.cart_id, false).await.unwrap();
    assert_eq!(result.verdict, "refused");
    assert_eq!(result.rule_cited.as_deref(), Some("over_per_txn_cap"));
    assert!(result.human_message.is_some());
    assert_eq!(
        repos::get_session_state(&pool, session).await.unwrap(),
        "REFUSED"
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn cart_rejects_cross_merchant_items(pool: PgPool) {
    let (merchant, cheap, _pricey) = seed_catalog(&pool).await;
    let other = repos::create_merchant(&pool, "Other Store", &json!(["upi"]))
        .await
        .unwrap();
    let other_item = insert_item(&pool, other, "Other Shoe", "footwear", 100_000).await;
    let session = seed_session(&pool, merchant, 300_000, 300_000).await;
    let store = Storefront::new(pool.clone());

    let err = store
        .create_cart(
            session,
            &[
                CartItemReq {
                    item_id: cheap,
                    qty: 1,
                },
                CartItemReq {
                    item_id: other_item,
                    qty: 1,
                },
            ],
        )
        .await;
    assert!(err.is_err(), "a cross-merchant cart must be rejected");
}
