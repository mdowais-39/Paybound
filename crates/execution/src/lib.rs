//! The execution plane: only kernel-approved authorizations arrive here. It
//! issues a scoped, single-use delegated token (the Shared-Payment-Token
//! pattern), makes the real Razorpay test-mode call (a payment link), and
//! records a `payment_effect` + audit entries. Every money call is idempotent.
//!
//! Idempotency: the durable guarantee is the `payment_effect.idempotency_key`
//! UNIQUE constraint. `authorize` claims the key with an atomic
//! `INSERT ... ON CONFLICT DO NOTHING` *before* creating the link, so a retry
//! never creates a second link or a double charge (stronger than a Redis-only
//! check; a Redis read-through cache is added in Phase 10). See DECISIONS.md.

use common::AppError;
use domain::AuditEventType;
use kernel::Authorization;
use ledger::{repos, AuditLedger, Db};
use razorpay_client::{PaymentGateway, PaymentLinkRequest};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

/// Static customer details for the demo storefront (test mode).
#[derive(Clone)]
pub struct ExecConfig {
    pub customer_name: String,
    pub customer_contact: String,
    pub customer_email: String,
}

impl Default for ExecConfig {
    fn default() -> Self {
        Self {
            customer_name: "Paybound Buyer".into(),
            customer_contact: "+918123456780".into(),
            customer_email: "buyer@paybound.test".into(),
        }
    }
}

/// The outcome of authorizing a purchase.
#[derive(Debug, Clone, Serialize)]
pub struct AuthorizeResult {
    pub payment_effect_id: Uuid,
    pub razorpay_ref: String,
    pub short_url: String,
    pub delegated_token: String,
    pub idempotency_key: String,
    /// True if this call matched a prior authorization (idempotent replay).
    pub deduplicated: bool,
}

/// The execution plane. Holds the payment gateway as a trait object so it is
/// both embeddable (e.g. inside the storefront's checkout) and testable against
/// a fake without touching the network.
pub struct ExecutionPlane {
    pool: Db,
    gateway: Arc<dyn PaymentGateway>,
    cfg: ExecConfig,
}

/// Deterministic idempotency key: same (session, cart, amount) always hashes to
/// the same key, so a retry is recognised as the same money action.
pub fn derive_idempotency_key(session_id: Uuid, cart_hash: &str, amount_paise: i64) -> String {
    let mut h = Sha256::new();
    h.update(session_id.as_bytes());
    h.update(cart_hash.as_bytes());
    h.update(amount_paise.to_le_bytes());
    hex::encode(h.finalize())
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

impl ExecutionPlane {
    pub fn new(pool: Db, gateway: Arc<dyn PaymentGateway>, cfg: ExecConfig) -> Self {
        Self { pool, gateway, cfg }
    }

    /// Turn a kernel authorization into a real Razorpay test-mode payment link,
    /// idempotently. Writes a `payment_effect`, issues a scoped single-use
    /// delegated token, appends audit entries, and moves the session to PAYING.
    #[tracing::instrument(name = "execution.authorize", level = "info", skip(self, auth), fields(%session_id, amount_paise = auth.amount_paise))]
    pub async fn authorize(
        &self,
        session_id: Uuid,
        auth: &Authorization,
    ) -> Result<AuthorizeResult, AppError> {
        let idem = derive_idempotency_key(session_id, &auth.cart_hash, auth.amount_paise);
        let token = random_token();

        // Atomically claim the idempotency key. Only the winner inserts a row.
        let claimed = sqlx::query!(
            "INSERT INTO payment_effect
               (session_id, delegated_token, idempotency_key, amount_paise, outcome)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING effect_id",
            session_id,
            token,
            idem,
            auth.amount_paise,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?;

        let Some(rec) = claimed else {
            // Lost the race / retry: return the existing effect (no new charge).
            return self.load_existing(&idem).await;
        };
        let effect_id = rec.effect_id;

        // We own this money action → create the REAL payment link.
        let link = self
            .gateway
            .create_payment_link(&PaymentLinkRequest {
                amount: auth.amount_paise,
                currency: "INR".into(),
                description: format!("Paybound purchase (session {session_id})"),
                reference_id: effect_id.to_string(),
                customer_name: self.cfg.customer_name.clone(),
                customer_contact: self.cfg.customer_contact.clone(),
                customer_email: self.cfg.customer_email.clone(),
            })
            .await?;

        sqlx::query!(
            "UPDATE payment_effect SET razorpay_ref = $1 WHERE effect_id = $2",
            link.id,
            effect_id
        )
        .execute(&self.pool)
        .await
        .map_err(db)?;

        // AP2 Payment Mandate — the third tier of the AP2 chain (Intent ->
        // Cart -> Payment). One row per real charge attempt, tying it back to
        // the exact Intent Mandate that authorized it and the exact cart
        // hash the kernel approved, so the chain is queryable end to end
        // rather than only informally reconstructible from scattered fields.
        sqlx::query!(
            "INSERT INTO payment_mandate (effect_id, authority_ref, agent_present, cart_hash)
             VALUES ($1, $2, $3, $4)",
            effect_id,
            auth.mandate_id,
            true,
            auth.cart_hash,
        )
        .execute(&self.pool)
        .await
        .map_err(db)?;

        // Commit this amount against the mandate's cumulative budget NOW, at
        // authorization — not when a `payment_link.paid` webhook eventually
        // arrives. The kernel's over_cumulative_budget check reads this same
        // field for every SUBSEQUENT purchase in the session; if it only moved
        // on webhook confirmation, a demo/manual flow that stops at "here's
        // your payment link" (the common case — nobody's obligated to click
        // it) would let the agent get approved for purchase after purchase
        // with the budget never visibly shrinking, silently defeating the
        // cumulative cap. This is a genuine authorization hold, exactly like a
        // credit card reducing available credit the moment a merchant
        // authorizes a charge, before settlement days later. `on_payment_paid`
        // no longer touches this field (it was already committed here);
        // `on_payment_failed` releases it back, since the money never moved.
        sqlx::query!(
            "UPDATE purchase_session
             SET running_spend_paise = running_spend_paise + $1, updated_at = now()
             WHERE session_id = $2",
            auth.amount_paise,
            session_id
        )
        .execute(&self.pool)
        .await
        .map_err(db)?;

        let ledger = AuditLedger::new(&self.pool);
        ledger
            .append(
                session_id,
                AuditEventType::TokenIssued,
                json!({ "delegated_token": token, "scope": { "amount_paise": auth.amount_paise, "single_use": true } }),
            )
            .await?;
        ledger
            .append(
                session_id,
                AuditEventType::PaymentEffect,
                json!({ "outcome": "pending", "razorpay_ref": link.id, "amount_paise": auth.amount_paise }),
            )
            .await?;
        repos::set_session_state(&self.pool, session_id, "PAYING").await?;

        Ok(AuthorizeResult {
            payment_effect_id: effect_id,
            razorpay_ref: link.id,
            short_url: link.short_url,
            delegated_token: token,
            idempotency_key: idem,
            deduplicated: false,
        })
    }

    async fn load_existing(&self, idem: &str) -> Result<AuthorizeResult, AppError> {
        let r = sqlx::query!(
            "SELECT effect_id, razorpay_ref, delegated_token FROM payment_effect
             WHERE idempotency_key = $1",
            idem
        )
        .fetch_one(&self.pool)
        .await
        .map_err(db)?;
        let razorpay_ref = r.razorpay_ref.unwrap_or_default();
        // Re-fetch the link URL (best-effort) so callers still get a payable URL.
        let short_url = if razorpay_ref.is_empty() {
            String::new()
        } else {
            self.gateway
                .fetch_payment_link(&razorpay_ref)
                .await
                .map(|l| l.short_url)
                .unwrap_or_default()
        };
        Ok(AuthorizeResult {
            payment_effect_id: r.effect_id,
            razorpay_ref,
            short_url,
            delegated_token: r.delegated_token.unwrap_or_default(),
            idempotency_key: idem.to_string(),
            deduplicated: true,
        })
    }

    /// Handle a verified `payment_link.paid` webhook: mark the effect paid,
    /// move the session to COMPLETED, and audit it. Does NOT touch
    /// `running_spend_paise` — that was already committed in `authorize()`,
    /// at the moment the kernel approved and the link was issued; crediting it
    /// again here would double-count the same purchase. Idempotent: a
    /// redelivered event is a no-op (the `pending` guard).
    pub async fn on_payment_paid(&self, razorpay_ref: &str) -> Result<bool, AppError> {
        let updated = sqlx::query!(
            "UPDATE payment_effect SET outcome = 'success'
             WHERE razorpay_ref = $1 AND outcome = 'pending'
             RETURNING session_id, amount_paise",
            razorpay_ref
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?;

        let Some(row) = updated else { return Ok(false) };

        AuditLedger::new(&self.pool)
            .append(
                row.session_id,
                AuditEventType::PaymentEffect,
                json!({ "outcome": "success", "razorpay_ref": razorpay_ref, "amount_paise": row.amount_paise }),
            )
            .await?;
        repos::set_session_state(&self.pool, row.session_id, "COMPLETED").await?;
        Ok(true)
    }

    /// Handle a verified payment failure (e.g. paid with `failure@razorpay`).
    /// Records a clean failure with NO hallucinated success; the session does
    /// not complete. Releases the authorization hold `authorize()` placed on
    /// `running_spend_paise` — the money never moved, so it must not keep
    /// counting against the mandate's budget for future purchases. Idempotent.
    pub async fn on_payment_failed(&self, razorpay_ref: &str) -> Result<bool, AppError> {
        let updated = sqlx::query!(
            "UPDATE payment_effect SET outcome = 'failed'
             WHERE razorpay_ref = $1 AND outcome = 'pending'
             RETURNING session_id, amount_paise",
            razorpay_ref
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?;

        let Some(row) = updated else { return Ok(false) };

        sqlx::query!(
            "UPDATE purchase_session
             SET running_spend_paise = running_spend_paise - $1, updated_at = now()
             WHERE session_id = $2",
            row.amount_paise,
            row.session_id
        )
        .execute(&self.pool)
        .await
        .map_err(db)?;

        AuditLedger::new(&self.pool)
            .append(
                row.session_id,
                AuditEventType::PaymentEffect,
                json!({ "outcome": "failed", "razorpay_ref": razorpay_ref, "amount_paise": row.amount_paise }),
            )
            .await?;
        Ok(true)
    }
}

fn db(e: sqlx::Error) -> AppError {
    AppError::Internal(format!("db: {e}"))
}
