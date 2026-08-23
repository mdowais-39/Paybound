//! The mandate model (borrowed from Google AP2): Intent → Cart → Payment.
//! Authority is a signed, chained object — never a flag (architecture §1).
//!
//! Signatures are ed25519 over the **canonical** JSON of each mandate's signing
//! view (see `common::canonical`), scoped deliberately to software keys, not
//! FIDO-grade hardware — the non-repudiation chain is what matters.

use crate::money::Paise;
use common::canonical::to_canonical_bytes;
use common::signing::{
    sign_value, verify_value, verifying_key_from_hex, verifying_key_hex, Ed25519SigningKey,
};
use common::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use uuid::Uuid;

/// One line of a cart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CartLineItem {
    pub item_id: Uuid,
    pub qty: i64,
    pub price_paise: Paise,
    pub category: String,
}

/// A proposed cart the agent submits to the kernel. Never pays by itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cart {
    pub merchant_id: Uuid,
    pub line_items: Vec<CartLineItem>,
    /// The total the agent claims. The kernel re-derives this from the items and
    /// refuses on any mismatch (cart-integrity check) — no blind trust.
    pub total_paise: Paise,
}

impl Cart {
    /// The true total, recomputed from the line items (qty × unit price).
    pub fn recomputed_total(&self) -> Paise {
        self.line_items
            .iter()
            .map(|li| li.qty.saturating_mul(li.price_paise))
            .sum()
    }

    /// The canonical view hashed for cart integrity / the Cart-Mandate link.
    fn integrity_value(&self) -> Value {
        json!({
            "merchant_id": self.merchant_id,
            "total_paise": self.total_paise,
            "line_items": self.line_items,
        })
    }

    /// A stable hash of the exact cart — used to detect price drift or item
    /// substitution between authorization and charge.
    pub fn cart_hash(&self) -> String {
        let mut h = Sha256::new();
        h.update(to_canonical_bytes(&self.integrity_value()));
        hex::encode(h.finalize())
    }
}

/// AP2 Intent Mandate — the signed, bounded envelope created at delegation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentMandate {
    pub mandate_id: Uuid,
    pub payer: String,
    pub budget_total_paise: Paise,
    pub per_txn_cap_paise: Paise,
    /// Positive allow-list. **Empty means unrestricted on this axis** — the hard
    /// bounds are still the amount caps and TTL. Documented so it's not a loophole.
    pub allowed_categories: Vec<String>,
    /// Positive allow-list of merchant ids. Empty means unrestricted (see above).
    pub allowed_merchants: Vec<Uuid>,
    pub ttl: OffsetDateTime,
    pub nl_goal: String,
    pub public_key: String, // hex ed25519 verifying key
    pub signature: String,  // hex ed25519 signature over signing_view()
}

impl IntentMandate {
    /// The exact fields covered by the signature (everything authorized, but not
    /// the signature or the public key itself). `ttl` is folded in as an integer
    /// unix timestamp for a stable, unambiguous representation.
    fn signing_view(&self) -> Value {
        json!({
            "mandate_id": self.mandate_id,
            "payer": self.payer,
            "budget_total_paise": self.budget_total_paise,
            "per_txn_cap_paise": self.per_txn_cap_paise,
            "allowed_categories": self.allowed_categories,
            "allowed_merchants": self.allowed_merchants,
            "ttl_unix": self.ttl.unix_timestamp(),
            "nl_goal": self.nl_goal,
        })
    }

    /// Verify the mandate's signature against its embedded public key. The
    /// kernel calls this first — an unverifiable mandate is refused outright.
    pub fn verify_signature(&self) -> Result<(), AppError> {
        let vk = verifying_key_from_hex(&self.public_key)?;
        verify_value(&vk, &self.signing_view(), &self.signature)
    }

    /// Build and sign an Intent Mandate with the given key. Used at delegation
    /// (the consent console) and throughout the tests.
    #[allow(clippy::too_many_arguments)]
    pub fn new_signed(
        key: &Ed25519SigningKey,
        mandate_id: Uuid,
        payer: impl Into<String>,
        budget_total_paise: Paise,
        per_txn_cap_paise: Paise,
        allowed_categories: Vec<String>,
        allowed_merchants: Vec<Uuid>,
        ttl: OffsetDateTime,
        nl_goal: impl Into<String>,
    ) -> Self {
        let mut m = IntentMandate {
            mandate_id,
            payer: payer.into(),
            budget_total_paise,
            per_txn_cap_paise,
            allowed_categories,
            allowed_merchants,
            ttl,
            nl_goal: nl_goal.into(),
            public_key: verifying_key_hex(key),
            signature: String::new(),
        };
        m.signature = sign_value(key, &m.signing_view());
        m
    }
}

/// AP2 Cart Mandate — the exact authorized cart, hash-chained to the intent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartMandate {
    pub cart_id: Uuid,
    pub session_id: Uuid,
    pub cart: Cart,
    /// Hash tying this cart to its Intent Mandate.
    pub intent_hash: String,
    pub signature: Option<String>,
}

/// AP2 Payment Mandate — records the agent-presence signal and the authority
/// reference alongside the actual charge, so money movement carries its
/// justification into the ledger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentMandate {
    pub authority_ref: Uuid, // the Intent Mandate id
    pub agent_present: bool, // false = human-not-present agentic transaction
    pub cart_hash: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use common::signing::generate_keypair;
    use time::Duration;

    fn sample_cart() -> Cart {
        Cart {
            merchant_id: Uuid::nil(),
            line_items: vec![CartLineItem {
                item_id: Uuid::nil(),
                qty: 1,
                price_paise: 285_000,
                category: "footwear".into(),
            }],
            total_paise: 285_000,
        }
    }

    #[test]
    fn cart_recomputes_and_hashes_stably() {
        let c = sample_cart();
        assert_eq!(c.recomputed_total(), 285_000);
        assert_eq!(c.cart_hash(), c.cart_hash());
    }

    #[test]
    fn signed_mandate_verifies_and_tamper_is_detected() {
        let key = generate_keypair();
        let mut m = IntentMandate::new_signed(
            &key,
            Uuid::new_v4(),
            "user_owais",
            300_000,
            300_000,
            vec!["footwear".into()],
            vec![],
            OffsetDateTime::now_utc() + Duration::hours(1),
            "buy running shoes under ₹3,000",
        );
        assert!(m.verify_signature().is_ok());

        // Tamper with an authorized field → signature no longer verifies.
        m.budget_total_paise = 9_999_999;
        assert!(m.verify_signature().is_err());
    }
}
