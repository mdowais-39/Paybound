//! Thin, compile-time-checked repositories for the core entities. Kept minimal
//! for Phase 1 (enough to create the merchant → mandate → session spine that
//! audit entries reference); extended as later phases need more surface.

use crate::{db_err, Db};
use common::AppError;
use domain::{IntentMandate, Paise};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

/// A session's mutable state needed by the kernel path.
pub struct SessionRow {
    pub session_id: Uuid,
    pub mandate_id: Uuid,
    pub state: String,
    pub running_spend_paise: Paise,
}

/// Parameters to persist a signed Intent Mandate. The `mandate_id` is part of
/// the signed envelope, so it is stored as-is (never regenerated) — otherwise
/// the signature would not verify on reconstruction.
pub struct NewIntentMandate<'a> {
    pub mandate_id: Uuid,
    pub payer: &'a str,
    pub budget_total_paise: Paise,
    pub per_txn_cap_paise: Paise,
    pub allowed_categories: &'a Value,
    pub allowed_merchants: &'a Value,
    pub ttl: OffsetDateTime,
    pub nl_goal: &'a str,
    pub public_key: &'a str,
    pub signature: &'a str,
}

/// Insert a merchant, returning its id.
pub async fn create_merchant(
    pool: &Db,
    name: &str,
    allowed_methods: &Value,
) -> Result<Uuid, AppError> {
    let id = sqlx::query_scalar!(
        "INSERT INTO merchant (name, allowed_methods) VALUES ($1, $2) RETURNING merchant_id",
        name,
        allowed_methods,
    )
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

/// Insert a signed Intent Mandate, returning its id.
pub async fn create_intent_mandate(pool: &Db, m: NewIntentMandate<'_>) -> Result<Uuid, AppError> {
    let id = sqlx::query_scalar!(
        "INSERT INTO intent_mandate
           (mandate_id, payer, budget_total_paise, per_txn_cap_paise, allowed_categories,
            allowed_merchants, ttl, nl_goal, public_key, signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING mandate_id",
        m.mandate_id,
        m.payer,
        m.budget_total_paise,
        m.per_txn_cap_paise,
        m.allowed_categories,
        m.allowed_merchants,
        m.ttl,
        m.nl_goal,
        m.public_key,
        m.signature,
    )
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

/// Open a new purchase session bound to a mandate (state = DELEGATED).
pub async fn create_session(pool: &Db, mandate_id: Uuid) -> Result<Uuid, AppError> {
    let id = sqlx::query_scalar!(
        "INSERT INTO purchase_session (mandate_id) VALUES ($1) RETURNING session_id",
        mandate_id,
    )
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

/// Read a session's current state string.
pub async fn get_session_state(pool: &Db, session_id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar!(
        "SELECT state FROM purchase_session WHERE session_id = $1",
        session_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))
}

/// Read a session's mandate binding, state, and running spend.
pub async fn get_session(pool: &Db, session_id: Uuid) -> Result<SessionRow, AppError> {
    let r = sqlx::query!(
        "SELECT session_id, mandate_id, state, running_spend_paise
         FROM purchase_session WHERE session_id = $1",
        session_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))?;
    Ok(SessionRow {
        session_id: r.session_id,
        mandate_id: r.mandate_id,
        state: r.state,
        running_spend_paise: r.running_spend_paise,
    })
}

/// Update a session's state.
pub async fn set_session_state(pool: &Db, session_id: Uuid, state: &str) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE purchase_session SET state = $1, updated_at = now() WHERE session_id = $2",
        state,
        session_id
    )
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

/// Load a signed Intent Mandate and reconstruct the domain type (so the kernel
/// can re-verify its signature and bounds).
pub async fn get_intent_mandate(pool: &Db, mandate_id: Uuid) -> Result<IntentMandate, AppError> {
    let r = sqlx::query!(
        "SELECT mandate_id, payer, budget_total_paise, per_txn_cap_paise,
                allowed_categories, allowed_merchants, ttl, nl_goal, public_key, signature
         FROM intent_mandate WHERE mandate_id = $1",
        mandate_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| AppError::NotFound(format!("mandate {mandate_id}")))?;

    let allowed_categories: Vec<String> = serde_json::from_value(r.allowed_categories)?;
    let allowed_merchants: Vec<Uuid> = serde_json::from_value(r.allowed_merchants)?;

    Ok(IntentMandate {
        mandate_id: r.mandate_id,
        payer: r.payer,
        budget_total_paise: r.budget_total_paise,
        per_txn_cap_paise: r.per_txn_cap_paise,
        allowed_categories,
        allowed_merchants,
        ttl: r.ttl,
        nl_goal: r.nl_goal,
        public_key: r.public_key,
        signature: r.signature,
    })
}

/// Record the kernel's decision on a cart — proof the gate ran on every buy.
pub async fn record_gate_decision(
    pool: &Db,
    session_id: Uuid,
    cart_id: Option<Uuid>,
    verdict: &str,
    rule_cited: Option<&str>,
) -> Result<Uuid, AppError> {
    let id = sqlx::query_scalar!(
        "INSERT INTO gate_decision (session_id, cart_id, verdict, rule_cited)
         VALUES ($1, $2, $3, $4) RETURNING decision_id",
        session_id,
        cart_id,
        verdict,
        rule_cited,
    )
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

/// Revoke a mandate's authority (instant revocation). Idempotent.
pub async fn revoke_mandate(pool: &Db, mandate_id: Uuid) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE intent_mandate SET revoked_at = now() WHERE mandate_id = $1 AND revoked_at IS NULL",
        mandate_id
    )
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

/// Whether a mandate has been revoked.
pub async fn is_mandate_revoked(pool: &Db, mandate_id: Uuid) -> Result<bool, AppError> {
    let revoked = sqlx::query_scalar!(
        "SELECT (revoked_at IS NOT NULL) FROM intent_mandate WHERE mandate_id = $1",
        mandate_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .flatten()
    .unwrap_or(false);
    Ok(revoked)
}
