//! The audit read API: GET /sessions/{id}/audit returns the narrated, hash-
//! verified chain.

use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use execution::{ExecConfig, ExecutionPlane};
use gateway::{build_router, AppState};
use ledger::repos::{self, NewIntentMandate};
use ledger::AuditLedger;
use razorpay_client::{Order, PaymentGateway, PaymentLink, PaymentLinkRequest};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Clone, Default)]
struct FakeGateway;

#[async_trait]
impl PaymentGateway for FakeGateway {
    async fn create_order(&self, amount: i64, _r: &str) -> Result<Order, common::AppError> {
        Ok(Order {
            id: "o".into(),
            status: "created".into(),
            amount,
        })
    }
    async fn create_payment_link(
        &self,
        req: &PaymentLinkRequest,
    ) -> Result<PaymentLink, common::AppError> {
        Ok(PaymentLink {
            id: "p".into(),
            status: "created".into(),
            short_url: "u".into(),
            amount: req.amount,
        })
    }
    async fn fetch_payment_link(&self, id: &str) -> Result<PaymentLink, common::AppError> {
        Ok(PaymentLink {
            id: id.into(),
            status: "created".into(),
            short_url: "u".into(),
            amount: 0,
        })
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn audit_endpoint_returns_narrated_verified_chain(pool: PgPool) {
    let merchant = repos::create_merchant(&pool, "Acme", &json!(["upi"]))
        .await
        .unwrap();
    let mandate_id = Uuid::new_v4();
    repos::create_intent_mandate(
        &pool,
        NewIntentMandate {
            mandate_id,
            payer: "user_owais",
            budget_total_paise: 300_000,
            per_txn_cap_paise: 300_000,
            allowed_categories: &json!(["footwear"]),
            allowed_merchants: &json!([merchant]),
            ttl: OffsetDateTime::now_utc() + Duration::hours(1),
            nl_goal: "buy shoes",
            public_key: "d",
            signature: "s",
            owner_token_hash: None,
        },
    )
    .await
    .unwrap();
    let session = repos::create_session(&pool, mandate_id).await.unwrap();

    let ledger = AuditLedger::new(&pool);
    ledger
        .append(
            session,
            domain::AuditEventType::SessionCreated,
            json!({"nl_goal": "buy shoes"}),
        )
        .await
        .unwrap();
    ledger
        .append(
            session,
            domain::AuditEventType::GateDecision,
            json!({"verdict": "approved", "amount_paise": 285_000}),
        )
        .await
        .unwrap();
    // Attach a narrative to the last entry (as the Python narrator would).
    sqlx::query("UPDATE audit_entry SET narrative = $1 WHERE session_id = $2 AND event_type = 'gate_decision'")
        .bind("Approved the ₹2,850 cart within the ₹3,000 mandate.")
        .bind(session)
        .execute(&pool)
        .await
        .unwrap();

    // A caller must be a known identity to call any protected endpoint at
    // all; this session's mandate has no owner (pre-auth data), so any valid
    // identity may read it.
    let token_hash = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(b"test-token"));
    repos::create_identity(&pool, &token_hash).await.unwrap();

    let exec = ExecutionPlane::new(pool.clone(), Arc::new(FakeGateway), ExecConfig::default());
    let app = build_router(AppState {
        exec: Arc::new(exec),
        pool: pool.clone(),
        webhook_secret: Arc::new("x".into()),
    });

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/sessions/{session}/audit"))
                .header("Authorization", "Bearer test-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["verified"], true);
    assert_eq!(body["entry_count"], 2);
    let entries = body["entries"].as_array().unwrap();
    assert_eq!(entries[0]["event_type"], "session_created");
    assert!(entries[1]["narrative"].as_str().unwrap().contains("₹2,850"));
    // The genesis entry links to nothing; the second links to the first.
    assert!(entries[0]["prev_hash"].is_null());
    assert_eq!(entries[1]["prev_hash"], entries[0]["this_hash"]);
}
