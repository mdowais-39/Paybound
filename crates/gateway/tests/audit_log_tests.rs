//! The flat, cross-session audit log: GET /audit lists an owner's audit entries
//! across ALL their sessions with server-side filtering, and
//! GET /audit/entries/{id}/context returns the mandate authority behind one.

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
        Ok(Order { id: "o".into(), status: "created".into(), amount })
    }
    async fn create_payment_link(&self, req: &PaymentLinkRequest) -> Result<PaymentLink, common::AppError> {
        Ok(PaymentLink { id: "p".into(), status: "created".into(), short_url: "u".into(), amount: req.amount })
    }
    async fn fetch_payment_link(&self, id: &str) -> Result<PaymentLink, common::AppError> {
        Ok(PaymentLink { id: id.into(), status: "created".into(), short_url: "u".into(), amount: 0 })
    }
}

fn token_hash(raw: &str) -> String {
    hex::encode(<sha2::Sha256 as sha2::Digest>::digest(raw.as_bytes()))
}

fn app(pool: &PgPool) -> axum::Router {
    let exec = ExecutionPlane::new(pool.clone(), Arc::new(FakeGateway), ExecConfig::default());
    build_router(AppState {
        exec: Arc::new(exec),
        pool: pool.clone(),
        webhook_secret: Arc::new("x".into()),
    })
}

async fn seed_session(pool: &PgPool, owner: Option<&str>) -> Uuid {
    let merchant = repos::create_merchant(pool, "Acme", &json!(["upi"])).await.unwrap();
    let owner_hash = owner.map(token_hash);
    if let Some(h) = &owner_hash {
        // Idempotent: the caller may have already created this identity.
        let _ = repos::create_identity(pool, h).await;
    }
    let mandate_id = Uuid::new_v4();
    repos::create_intent_mandate(
        pool,
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
            owner_token_hash: owner_hash.as_deref(),
        },
    )
    .await
    .unwrap();
    repos::create_session(pool, mandate_id).await.unwrap()
}

async fn send(app: &axum::Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

#[sqlx::test(migrations = "../../migrations")]
async fn audit_log_flattens_across_sessions_and_filters(pool: PgPool) {
    // Two DIFFERENT sessions under the same owner — the flat log must span both.
    let s1 = seed_session(&pool, Some("owner")).await;
    let s2 = seed_session(&pool, Some("owner")).await;
    let led = AuditLedger::new(&pool);
    led.append(s1, domain::AuditEventType::SessionCreated, json!({"nl_goal": "buy shoes"})).await.unwrap();
    led.append(s1, domain::AuditEventType::GateDecision,
               json!({"verdict": "approved", "amount_paise": 285_000})).await.unwrap();
    led.append(s2, domain::AuditEventType::GateDecision,
               json!({"verdict": "refused", "rule_cited": "over_per_txn_cap", "amount_paise": 999_000})).await.unwrap();

    let a = app(&pool);

    // Unfiltered: all three entries, across both sessions.
    let (st, body) = send(&a, "/audit", "owner").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["entry_count"], 3);

    // Filter by event_type: only the two gate decisions.
    let (_, body) = send(&a, "/audit?event_type=gate_decision", "owner").await;
    assert_eq!(body["entry_count"], 2);

    // Filter by verdict: only the refused one — and its lifted fields are present.
    let (_, body) = send(&a, "/audit?verdict=refused", "owner").await;
    assert_eq!(body["entry_count"], 1);
    let e = &body["entries"][0];
    assert_eq!(e["verdict"], "refused");
    assert_eq!(e["rule_cited"], "over_per_txn_cap");
    assert_eq!(e["amount_paise"], 999_000);

    // Free-text search over the payload.
    let (_, body) = send(&a, "/audit?q=over_per_txn_cap", "owner").await;
    assert_eq!(body["entry_count"], 1);

    // Exact session_id filter — the "cart story" view fetches ALL of one
    // session's entries, independent of the other filters.
    let (_, body) = send(&a, &format!("/audit?session_id={s1}"), "owner").await;
    assert_eq!(body["entry_count"], 2);
    assert!(body["entries"].as_array().unwrap().iter().all(|e| e["session_id"] == s1.to_string()));
}

#[sqlx::test(migrations = "../../migrations")]
async fn audit_log_is_owner_scoped(pool: PgPool) {
    let s = seed_session(&pool, Some("owner")).await;
    AuditLedger::new(&pool)
        .append(s, domain::AuditEventType::SessionCreated, json!({"x": 1}))
        .await
        .unwrap();
    repos::create_identity(&pool, &token_hash("intruder")).await.unwrap();
    let a = app(&pool);

    // The intruder is a valid identity but owns nothing — sees an empty log,
    // not another owner's entries.
    let (st, body) = send(&a, "/audit", "intruder").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["entry_count"], 0);
}

#[sqlx::test(migrations = "../../migrations")]
async fn audit_entry_context_returns_mandate_authority(pool: PgPool) {
    let s = seed_session(&pool, Some("owner")).await;
    let entry = AuditLedger::new(&pool)
        .append(s, domain::AuditEventType::GateDecision, json!({"verdict": "approved"}))
        .await
        .unwrap();
    let a = app(&pool);

    let (st, body) = send(&a, &format!("/audit/entries/{}/context", entry.entry_id), "owner").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["payer"], "user_owais");
    assert_eq!(body["budget_total_paise"], 300_000);
    assert_eq!(body["per_txn_cap_paise"], 300_000);
    assert_eq!(body["allowed_categories"][0], "footwear");

    // A different identity cannot read the context.
    repos::create_identity(&pool, &token_hash("intruder")).await.unwrap();
    let (st, _) = send(&a, &format!("/audit/entries/{}/context", entry.entry_id), "intruder").await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}
