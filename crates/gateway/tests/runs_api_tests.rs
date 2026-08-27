//! The console run-history API: GET /mandates/{id}/runs lists a mandate's runs
//! newest-first, DELETE removes one — both owner-scoped.

use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use execution::{ExecConfig, ExecutionPlane};
use gateway::{build_router, AppState};
use ledger::repos::{self, NewIntentMandate};
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

/// Seed a merchant + an owned mandate + its session, returning (mandate, session).
async fn seed_owned(pool: &PgPool, owner: &str) -> (Uuid, Uuid) {
    let merchant = repos::create_merchant(pool, "Acme", &json!(["upi"])).await.unwrap();
    repos::create_identity(pool, &token_hash(owner)).await.unwrap();
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
            owner_token_hash: Some(&token_hash(owner)),
        },
    )
    .await
    .unwrap();
    let session = repos::create_session(pool, mandate_id).await.unwrap();
    (mandate_id, session)
}

async fn insert_run(pool: &PgPool, run_id: &str, session: Uuid, mandate: Uuid, goal: &str, state: &str) {
    sqlx::query(
        "INSERT INTO agent_run (run_id, session_id, mandate_id, goal, state, total_paise, result_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(run_id)
    .bind(session)
    .bind(mandate)
    .bind(goal)
    .bind(state)
    .bind(0_i64)
    .bind(json!({ "state": state, "message": goal }))
    .execute(pool)
    .await
    .unwrap();
}

async fn send(app: &axum::Router, method: &str, uri: &str, token: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
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
async fn list_runs_returns_a_mandates_runs_newest_first(pool: PgPool) {
    let (mandate, session) = seed_owned(&pool, "owner-tok").await;
    insert_run(&pool, "run_a", session, mandate, "buy running shoes", "COMPLETED").await;
    insert_run(&pool, "run_b", session, mandate, "buy a sofa", "REFUSED").await;
    let app = app(&pool);

    let (status, body) = send(&app, "GET", &format!("/mandates/{mandate}/runs"), "owner-tok").await;
    assert_eq!(status, StatusCode::OK);
    let runs = body.as_array().unwrap();
    assert_eq!(runs.len(), 2);
    // Newest-first: run_b was inserted second.
    assert_eq!(runs[0]["run_id"], "run_b");
    assert_eq!(runs[0]["state"], "REFUSED");
    // The full result snapshot round-trips for a faithful UI rebuild.
    assert_eq!(runs[0]["result"]["message"], "buy a sofa");
}

#[sqlx::test(migrations = "../../migrations")]
async fn runs_are_owner_scoped(pool: PgPool) {
    let (mandate, session) = seed_owned(&pool, "owner-tok").await;
    insert_run(&pool, "run_a", session, mandate, "buy running shoes", "COMPLETED").await;
    // A different, known identity must not see or delete another owner's runs.
    repos::create_identity(&pool, &token_hash("intruder")).await.unwrap();
    let app = app(&pool);

    let (status, _) = send(&app, "GET", &format!("/mandates/{mandate}/runs"), "intruder").await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = send(&app, "DELETE", &format!("/mandates/{mandate}/runs/run_a"), "intruder").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../../migrations")]
async fn delete_run_removes_it(pool: PgPool) {
    let (mandate, session) = seed_owned(&pool, "owner-tok").await;
    insert_run(&pool, "run_a", session, mandate, "buy running shoes", "COMPLETED").await;
    let app = app(&pool);

    let (status, body) = send(&app, "DELETE", &format!("/mandates/{mandate}/runs/run_a"), "owner-tok").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], true);

    let (status, body) = send(&app, "GET", &format!("/mandates/{mandate}/runs"), "owner-tok").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}
