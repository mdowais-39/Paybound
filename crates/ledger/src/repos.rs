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
    /// SHA-256 hex hash of the bearer token that created this mandate — who
    /// is allowed to list, read, or revoke it. `None` only for pre-auth data
    /// (dev seed binaries) that predates identity.
    pub owner_token_hash: Option<&'a str>,
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
            allowed_merchants, ttl, nl_goal, public_key, signature, owner_token_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        m.owner_token_hash,
    )
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

/// Store a newly minted identity's token hash (the raw token is never
/// persisted — only its SHA-256 hex hash, so a DB leak can't recover it).
pub async fn create_identity(pool: &Db, token_hash: &str) -> Result<(), AppError> {
    sqlx::query!("INSERT INTO identity (token_hash) VALUES ($1)", token_hash)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Whether a presented bearer token's hash is a known, valid identity.
pub async fn identity_exists(pool: &Db, token_hash: &str) -> Result<bool, AppError> {
    let row = sqlx::query_scalar!(
        "SELECT 1 AS \"exists!\" FROM identity WHERE token_hash = $1",
        token_hash
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?;
    Ok(row.is_some())
}

/// A mandate's owner (`None` for pre-auth dev data) — used to check whether
/// a presented token is allowed to read/act on it.
pub async fn get_mandate_owner(pool: &Db, mandate_id: Uuid) -> Result<Option<String>, AppError> {
    let row = sqlx::query_scalar!(
        "SELECT owner_token_hash FROM intent_mandate WHERE mandate_id = $1",
        mandate_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| AppError::NotFound(format!("mandate {mandate_id}")))?;
    Ok(row)
}

/// A session's mandate's owner — used to authorize reads/actions on the
/// session (audit, agent run/approve) by the mandate that owns it.
pub async fn get_session_owner(pool: &Db, session_id: Uuid) -> Result<Option<String>, AppError> {
    let row = sqlx::query_scalar!(
        "SELECT m.owner_token_hash FROM purchase_session s
         JOIN intent_mandate m USING (mandate_id) WHERE s.session_id = $1",
        session_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))?;
    Ok(row)
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

/// One row of the mandate console listing: the mandate plus its bound
/// session's live state and spend, so the frontend can render a spend meter
/// without a second round-trip.
pub struct MandateSummaryRow {
    pub mandate_id: Uuid,
    pub payer: String,
    pub budget_total_paise: Paise,
    pub per_txn_cap_paise: Paise,
    pub allowed_categories: Value,
    pub allowed_merchants: Value,
    pub ttl: OffsetDateTime,
    pub nl_goal: String,
    pub revoked: bool,
    pub session_id: Option<Uuid>,
    pub session_state: Option<String>,
    pub running_spend_paise: Option<Paise>,
}

/// List mandates newest-first, each joined to the (first) session created
/// with it — the shape the Mandate Console renders directly.
/// List mandates OWNED BY `owner_token_hash`, newest-first, each joined to
/// the (first) session created with it. Scoped by owner so one identity can
/// never see another's mandates — the Mandate Console's data source.
pub async fn list_mandates(
    pool: &Db,
    owner_token_hash: &str,
    limit: i64,
) -> Result<Vec<MandateSummaryRow>, AppError> {
    let rows = sqlx::query!(
        "SELECT m.mandate_id, m.payer, m.budget_total_paise, m.per_txn_cap_paise,
                m.allowed_categories, m.allowed_merchants, m.ttl, m.nl_goal,
                (m.revoked_at IS NOT NULL) AS \"revoked!\",
                s.session_id AS \"session_id?\", s.state AS \"session_state?\",
                s.running_spend_paise AS \"running_spend_paise?\"
         FROM intent_mandate m
         LEFT JOIN LATERAL (
             SELECT session_id, state, running_spend_paise FROM purchase_session
             WHERE mandate_id = m.mandate_id ORDER BY created_at ASC LIMIT 1
         ) s ON true
         WHERE m.owner_token_hash = $2
         ORDER BY m.created_at DESC LIMIT $1",
        limit,
        owner_token_hash,
    )
    .fetch_all(pool)
    .await
    .map_err(db_err)?;

    Ok(rows
        .into_iter()
        .map(|r| MandateSummaryRow {
            mandate_id: r.mandate_id,
            payer: r.payer,
            budget_total_paise: r.budget_total_paise,
            per_txn_cap_paise: r.per_txn_cap_paise,
            allowed_categories: r.allowed_categories,
            allowed_merchants: r.allowed_merchants,
            ttl: r.ttl,
            nl_goal: r.nl_goal,
            revoked: r.revoked,
            session_id: r.session_id,
            session_state: r.session_state,
            running_spend_paise: r.running_spend_paise,
        })
        .collect())
}

/// A session's state joined with its mandate's bounds — the shape the shop
/// page polls to show a live spend meter alongside the session state.
pub struct SessionSummaryRow {
    pub session_id: Uuid,
    pub mandate_id: Uuid,
    pub state: String,
    pub running_spend_paise: Paise,
    pub budget_total_paise: Paise,
    pub per_txn_cap_paise: Paise,
    pub latest_cart_id: Option<Uuid>,
}

/// Read a session's state + spend + its mandate's bounds + its latest cart.
pub async fn get_session_summary(
    pool: &Db,
    session_id: Uuid,
) -> Result<SessionSummaryRow, AppError> {
    let r = sqlx::query!(
        "SELECT s.session_id, s.mandate_id, s.state, s.running_spend_paise,
                m.budget_total_paise, m.per_txn_cap_paise,
                (SELECT cart_id FROM cart_mandate WHERE session_id = s.session_id
                   ORDER BY created_at DESC LIMIT 1) AS \"latest_cart_id?\"
         FROM purchase_session s JOIN intent_mandate m USING (mandate_id)
         WHERE s.session_id = $1",
        session_id
    )
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))?;

    Ok(SessionSummaryRow {
        session_id: r.session_id,
        mandate_id: r.mandate_id,
        state: r.state,
        running_spend_paise: r.running_spend_paise,
        budget_total_paise: r.budget_total_paise,
        per_txn_cap_paise: r.per_txn_cap_paise,
        latest_cart_id: r.latest_cart_id,
    })
}

/// Find a merchant by name, if one exists (used to resolve the default demo
/// merchant a mandate is scoped to when the caller doesn't specify one).
pub async fn find_merchant_by_name(pool: &Db, name: &str) -> Result<Option<Uuid>, AppError> {
    sqlx::query_scalar!("SELECT merchant_id FROM merchant WHERE name = $1", name)
        .fetch_optional(pool)
        .await
        .map_err(db_err)
}

/// The distinct catalog categories a merchant sells — feeds the mandate
/// form's category picker and the default allow-list when none is given.
pub async fn list_categories(pool: &Db, merchant_id: Uuid) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar!(
        "SELECT DISTINCT category FROM catalog_item WHERE merchant_id = $1 ORDER BY category",
        merchant_id
    )
    .fetch_all(pool)
    .await
    .map_err(db_err)
}

/// Every distinct category across the whole catalog — the category picker for a
/// marketplace-wide mandate (no single merchant).
pub async fn list_all_categories(pool: &Db) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar!("SELECT DISTINCT category FROM catalog_item ORDER BY category")
        .fetch_all(pool)
        .await
        .map_err(db_err)
}
