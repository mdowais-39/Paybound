//! Thin, compile-time-checked repositories for the core entities. Kept minimal
//! for Phase 1 (enough to create the merchant → mandate → session spine that
//! audit entries reference); extended as later phases need more surface.

use crate::{db_err, Db};
use common::AppError;
use domain::Paise;
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

/// Parameters to persist a signed Intent Mandate.
pub struct NewIntentMandate<'a> {
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
           (payer, budget_total_paise, per_txn_cap_paise, allowed_categories,
            allowed_merchants, ttl, nl_goal, public_key, signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING mandate_id",
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
