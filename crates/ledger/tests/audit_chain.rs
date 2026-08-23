//! Integration tests for the hash-chained audit ledger. `#[sqlx::test]`
//! provisions a fresh database per test and applies the migrations, so each
//! test runs against a clean, real Postgres schema.

use domain::AuditEventType;
use ledger::repos::{self, NewIntentMandate};
use ledger::AuditLedger;
use serde_json::json;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

/// Create the merchant → mandate → session spine that audit entries reference.
async fn seed_session(pool: &PgPool) -> Uuid {
    let merchant = repos::create_merchant(pool, "Acme Sports", &json!(["upi", "card"]))
        .await
        .unwrap();
    let mandate = repos::create_intent_mandate(
        pool,
        NewIntentMandate {
            mandate_id: Uuid::new_v4(),
            payer: "user_owais",
            budget_total_paise: 300_000, // ₹3,000
            per_txn_cap_paise: 300_000,
            allowed_categories: &json!(["footwear"]),
            allowed_merchants: &json!([merchant]),
            ttl: OffsetDateTime::now_utc() + Duration::hours(1),
            nl_goal: "buy running shoes under ₹3,000",
            public_key: "deadbeef",
            signature: "cafebabe",
        },
    )
    .await
    .unwrap();
    repos::create_session(pool, mandate).await.unwrap()
}

async fn append_five(ledger: &AuditLedger<'_>, session_id: Uuid) {
    for (et, payload) in [
        (AuditEventType::SessionCreated, json!({"who": "user_owais"})),
        (
            AuditEventType::PreCheckPassed,
            json!({"checks": ["mandate", "sanitisation"]}),
        ),
        (AuditEventType::CartBuilt, json!({"total_paise": 285_000})),
        (AuditEventType::GateDecision, json!({"verdict": "approved"})),
        (AuditEventType::PaymentEffect, json!({"outcome": "success"})),
    ] {
        ledger.append(session_id, et, payload).await.unwrap();
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn append_five_then_verify_chain_passes(pool: PgPool) {
    let session_id = seed_session(&pool).await;
    let ledger = AuditLedger::new(&pool);

    append_five(&ledger, session_id).await;

    let chain = ledger.list_chain(session_id).await.unwrap();
    assert_eq!(chain.len(), 5);
    // The genesis entry has no prev_hash; every later entry links to the prior.
    assert!(chain[0].prev_hash.is_none());
    assert_eq!(
        chain[1].prev_hash.as_deref(),
        Some(chain[0].this_hash.as_str())
    );

    assert!(
        ledger.verify_chain(session_id).await.unwrap(),
        "an untampered chain must verify"
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn tampering_entry_three_breaks_verification(pool: PgPool) {
    let session_id = seed_session(&pool).await;
    let ledger = AuditLedger::new(&pool);
    append_five(&ledger, session_id).await;

    assert!(ledger.verify_chain(session_id).await.unwrap());

    // Mutate the payload of the 3rd entry (index 2) — leaving its stored
    // this_hash untouched, exactly as a silent tamper would.
    let chain = ledger.list_chain(session_id).await.unwrap();
    let victim = chain[2].entry_id;
    sqlx::query!(
        "UPDATE audit_entry SET payload = $1 WHERE entry_id = $2",
        json!({"total_paise": 9_999_999}),
        victim
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(
        !ledger.verify_chain(session_id).await.unwrap(),
        "tampering with entry 3's payload must fail verification"
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn rewriting_a_stored_hash_also_breaks_the_link(pool: PgPool) {
    let session_id = seed_session(&pool).await;
    let ledger = AuditLedger::new(&pool);
    append_five(&ledger, session_id).await;

    // Overwrite entry 2's this_hash — this breaks entry 3's prev-hash link.
    let chain = ledger.list_chain(session_id).await.unwrap();
    sqlx::query!(
        "UPDATE audit_entry SET this_hash = $1 WHERE entry_id = $2",
        "0000000000000000000000000000000000000000000000000000000000000000",
        chain[1].entry_id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!ledger.verify_chain(session_id).await.unwrap());
}
