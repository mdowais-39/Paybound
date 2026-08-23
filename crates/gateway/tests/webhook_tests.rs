//! End-to-end test of the webhook receiver: a correctly HMAC-signed
//! `payment_link.paid` event completes the session; a bad signature is rejected.

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use execution::{ExecConfig, ExecutionPlane};
use gateway::{build_router, AppState};
use kernel::Authorization;
use ledger::repos::{self, NewIntentMandate};
use razorpay_client::webhook::sign_webhook;
use razorpay_client::{Order, PaymentGateway, PaymentLink, PaymentLinkRequest};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt; // oneshot
use uuid::Uuid;

#[derive(Clone, Default)]
struct FakeGateway;

#[async_trait]
impl PaymentGateway for FakeGateway {
    async fn create_order(&self, amount: i64, _r: &str) -> Result<Order, common::AppError> {
        Ok(Order {
            id: "order_fake".into(),
            status: "created".into(),
            amount,
        })
    }
    async fn create_payment_link(
        &self,
        req: &PaymentLinkRequest,
    ) -> Result<PaymentLink, common::AppError> {
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

async fn seed_session(pool: &PgPool) -> Uuid {
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
        },
    )
    .await
    .unwrap();
    repos::create_session(pool, mandate_id).await.unwrap()
}

const SECRET: &str = "whsec_paybound_test";

#[sqlx::test(migrations = "../../migrations")]
async fn signed_paid_webhook_completes_session_bad_signature_rejected(pool: PgPool) {
    let session = seed_session(&pool).await;

    // Authorize to get a pending payment_effect with a known razorpay_ref.
    let exec = ExecutionPlane::new(pool.clone(), FakeGateway, ExecConfig::default());
    let auth = Authorization {
        mandate_id: Uuid::new_v4(),
        cart_hash: "h".into(),
        amount_paise: 285_000,
    };
    let r = exec.authorize(session, &auth).await.unwrap();

    let state = AppState {
        exec: Arc::new(exec),
        webhook_secret: Arc::new(SECRET.to_string()),
    };
    let app = build_router(state);

    let body = json!({
        "event": "payment_link.paid",
        "payload": { "payment_link": { "entity": { "id": r.razorpay_ref } } }
    })
    .to_string();

    // 1. Valid signature → 200 and the session completes.
    let sig = sign_webhook(SECRET, body.as_bytes());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/webhooks/razorpay")
                .header("content-type", "application/json")
                .header("X-Razorpay-Signature", sig)
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        repos::get_session_state(&pool, session).await.unwrap(),
        "COMPLETED"
    );

    // 2. Bad signature → 401 (rejected, no state change).
    let resp2 = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/webhooks/razorpay")
                .header("content-type", "application/json")
                .header("X-Razorpay-Signature", "deadbeef")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp2.status(), StatusCode::UNAUTHORIZED);
}
