//! Execution-plane integration tests using a FAKE payment gateway (no network),
//! so idempotency and the paid/failed webhook handling are deterministic.

use async_trait::async_trait;
use execution::{ExecConfig, ExecutionPlane};
use kernel::Authorization;
use ledger::repos::{self, NewIntentMandate};
use razorpay_client::{Order, PaymentGateway, PaymentLink, PaymentLinkRequest};
use serde_json::json;
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

/// A fake gateway that counts payment-link creations and returns canned links.
#[derive(Clone, Default)]
struct FakeGateway {
    create_calls: Arc<AtomicUsize>,
}

#[async_trait]
impl PaymentGateway for FakeGateway {
    async fn create_order(
        &self,
        amount_paise: i64,
        _receipt: &str,
    ) -> Result<Order, common::AppError> {
        Ok(Order {
            id: "order_fake".into(),
            status: "created".into(),
            amount: amount_paise,
        })
    }
    async fn create_payment_link(
        &self,
        req: &PaymentLinkRequest,
    ) -> Result<PaymentLink, common::AppError> {
        self.create_calls.fetch_add(1, Ordering::SeqCst);
        Ok(PaymentLink {
            id: format!("plink_fake_{}", req.reference_id),
            status: "created".into(),
            short_url: "https://rzp.io/fake".into(),
            amount: req.amount,
        })
    }
    async fn fetch_payment_link(&self, id: &str) -> Result<PaymentLink, common::AppError> {
        Ok(PaymentLink {
            id: id.into(),
            status: "created".into(),
            short_url: "https://rzp.io/fake".into(),
            amount: 0,
        })
    }
}

async fn seed_session(pool: &PgPool) -> (Uuid, Uuid) {
    let merchant = repos::create_merchant(pool, "Acme", &json!(["upi"]))
        .await
        .unwrap();
    let mandate_id = Uuid::new_v4();
    repos::create_intent_mandate(
        pool,
        NewIntentMandate {
            mandate_id,
            payer: "user_owais",
            budget_total_paise: 1_000_000,
            per_txn_cap_paise: 1_000_000,
            allowed_categories: &json!(["footwear"]),
            allowed_merchants: &json!([merchant]),
            ttl: OffsetDateTime::now_utc() + Duration::hours(1),
            nl_goal: "goal",
            public_key: "deadbeef",
            signature: "cafebabe",
            owner_token_hash: None,
        },
    )
    .await
    .unwrap();
    let session = repos::create_session(pool, mandate_id).await.unwrap();
    (session, mandate_id)
}

fn auth(mandate_id: Uuid, amount: i64) -> Authorization {
    Authorization {
        mandate_id,
        cart_hash: "cart_hash_abc".into(),
        amount_paise: amount,
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn authorize_creates_a_payment_link_and_moves_to_paying(pool: PgPool) {
    let (session, mandate) = seed_session(&pool).await;
    let gw = FakeGateway::default();
    let calls = gw.create_calls.clone();
    let exec = ExecutionPlane::new(pool.clone(), std::sync::Arc::new(gw), ExecConfig::default());

    let r = exec
        .authorize(session, &auth(mandate, 285_000))
        .await
        .unwrap();
    assert!(!r.deduplicated);
    assert!(r.razorpay_ref.starts_with("plink_fake_"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        repos::get_session_state(&pool, session).await.unwrap(),
        "PAYING"
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn duplicate_authorize_does_not_double_charge(pool: PgPool) {
    let (session, mandate) = seed_session(&pool).await;
    let gw = FakeGateway::default();
    let calls = gw.create_calls.clone();
    let exec = ExecutionPlane::new(pool.clone(), std::sync::Arc::new(gw), ExecConfig::default());

    let a = auth(mandate, 285_000);
    let r1 = exec.authorize(session, &a).await.unwrap();
    let r2 = exec.authorize(session, &a).await.unwrap(); // retry, same idempotency key

    assert!(!r1.deduplicated);
    assert!(
        r2.deduplicated,
        "second call must be recognised as a replay"
    );
    assert_eq!(r1.payment_effect_id, r2.payment_effect_id);
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "only ONE payment link created"
    );

    // Exactly one payment_effect row exists.
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM payment_effect WHERE session_id = $1")
        .bind(session)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[sqlx::test(migrations = "../../migrations")]
async fn paid_webhook_completes_session_and_is_idempotent(pool: PgPool) {
    let (session, mandate) = seed_session(&pool).await;
    let gw = FakeGateway::default();
    let exec = ExecutionPlane::new(pool.clone(), std::sync::Arc::new(gw), ExecConfig::default());
    let r = exec
        .authorize(session, &auth(mandate, 285_000))
        .await
        .unwrap();

    assert!(exec.on_payment_paid(&r.razorpay_ref).await.unwrap());
    assert_eq!(
        repos::get_session_state(&pool, session).await.unwrap(),
        "COMPLETED"
    );

    let spend: i64 =
        sqlx::query_scalar("SELECT running_spend_paise FROM purchase_session WHERE session_id=$1")
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(spend, 285_000);

    // Redelivery is a no-op (returns false, no double-count).
    assert!(!exec.on_payment_paid(&r.razorpay_ref).await.unwrap());
    let spend2: i64 =
        sqlx::query_scalar("SELECT running_spend_paise FROM purchase_session WHERE session_id=$1")
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(spend2, 285_000);
}

#[sqlx::test(migrations = "../../migrations")]
async fn failed_webhook_records_clean_failure_without_completing(pool: PgPool) {
    let (session, mandate) = seed_session(&pool).await;
    let gw = FakeGateway::default();
    let exec = ExecutionPlane::new(pool.clone(), std::sync::Arc::new(gw), ExecConfig::default());
    let r = exec
        .authorize(session, &auth(mandate, 285_000))
        .await
        .unwrap();

    assert!(exec.on_payment_failed(&r.razorpay_ref).await.unwrap());

    // No hallucinated success: outcome is failed, session did NOT complete.
    let outcome: String =
        sqlx::query_scalar("SELECT outcome FROM payment_effect WHERE effect_id=$1")
            .bind(r.payment_effect_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(outcome, "failed");
    assert_ne!(
        repos::get_session_state(&pool, session).await.unwrap(),
        "COMPLETED"
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn delegated_token_is_single_use(pool: PgPool) {
    let (session, mandate) = seed_session(&pool).await;
    let gw = FakeGateway::default();
    let exec = ExecutionPlane::new(pool.clone(), Arc::new(gw), ExecConfig::default());
    let r = exec
        .authorize(session, &auth(mandate, 285_000))
        .await
        .unwrap();

    // Reusing the same scoped delegated token for a second payment_effect must
    // fail (UNIQUE constraint) — the token is single-use by construction.
    let reuse = sqlx::query(
        "INSERT INTO payment_effect (session_id, delegated_token, idempotency_key, amount_paise, outcome)
         VALUES ($1, $2, $3, $4, 'pending')",
    )
    .bind(session)
    .bind(&r.delegated_token)
    .bind("a-different-idempotency-key")
    .bind(100_000i64)
    .execute(&pool)
    .await;
    assert!(
        reuse.is_err(),
        "a delegated token cannot back a second payment"
    );
}
