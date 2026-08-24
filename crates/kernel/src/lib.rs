//! The Mandate & Consent Kernel — the crown jewel.
//!
//! A **pure, zero-I/O** deterministic gate (Part F #1): it takes a proposed
//! cart, the active mandate, the running spend, and the current time, and
//! returns an approval or a typed refusal with the rule cited. It performs no
//! database or network calls; the reserve-ledger read happens outside and the
//! running spend is passed in. This is the single point of enforcement — the
//! agent has no path around it, and over-limit carts are removed from the
//! choice set *before* the agent can act.
//!
//! Checks run in a deliberate order — authenticity → validity → integrity →
//! scope → amounts — so the cited reason is the most fundamental failure:
//! signature, then TTL, then cart integrity, then category, then merchant, then
//! per-transaction cap, then cumulative budget, then the AFA (₹15,000) gate.

pub mod refusal;

pub use refusal::RefusalReason;

use domain::{Cart, IntentMandate, Paise, AFA_THRESHOLD_PAISE};
use time::OffsetDateTime;

/// The kernel's decision. `Approved` carries the authorization to hand to the
/// execution plane; `Refused` carries the single rule that fired.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KernelDecision {
    Approved(Authorization),
    Refused(RefusalReason),
}

/// Proof, produced only by the kernel, that a specific cart passed every bound.
/// The execution plane will not act without one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authorization {
    pub mandate_id: uuid::Uuid,
    pub cart_hash: String,
    pub amount_paise: Paise,
}

/// Everything the kernel needs to decide. All of it is data — nothing here does I/O.
pub struct KernelInput<'a> {
    pub mandate: &'a IntentMandate,
    pub cart: &'a Cart,
    /// Already-committed spend against this mandate's budget (read from the
    /// Reserve-Pay ledger by the caller).
    pub running_spend_paise: Paise,
    pub now: OffsetDateTime,
    /// If set, the cart's hash must equal this (detects price drift / item
    /// substitution between authorization and charge).
    pub expected_cart_hash: Option<&'a str>,
    /// True once a human has given a PIN-equivalent approval — clears the
    /// ₹15,000 AFA gate (the NEEDS_HUMAN resume path). All other bounds still
    /// apply; a human approval cannot exceed the per-txn cap or budget.
    pub afa_approved: bool,
    /// True if the human has revoked this mandate's authority — refuse outright.
    pub revoked: bool,
}

/// Evaluate a proposed cart against its mandate. Pure and total: same inputs
/// always yield the same decision.
pub fn evaluate(input: &KernelInput<'_>) -> KernelDecision {
    let m = input.mandate;
    let cart = input.cart;

    // 0. Revocation — a killed mandate can never spend, whatever else is true.
    if input.revoked {
        return refuse(RefusalReason::MandateRevoked);
    }
    // 1. Authenticity — the mandate must be signed and verifiable.
    if m.verify_signature().is_err() {
        return refuse(RefusalReason::SignatureInvalid);
    }
    // 2. Validity — within the TTL window.
    if !check_ttl(m, input.now) {
        return refuse(RefusalReason::MandateExpired);
    }
    // 3. Integrity — the cart's claimed total/hash matches its contents.
    if !check_cart_integrity(cart, input.expected_cart_hash) {
        return refuse(RefusalReason::CartIntegrityMismatch);
    }
    // 4. Category scope.
    if !check_categories(m, cart) {
        return refuse(RefusalReason::CategoryNotAllowed);
    }
    // 5. Merchant scope.
    if !check_merchant(m, cart) {
        return refuse(RefusalReason::MerchantNotAllowed);
    }
    // 6. Per-transaction cap.
    if cart.total_paise > m.per_txn_cap_paise {
        return refuse(RefusalReason::OverPerTxnCap);
    }
    // 7. Cumulative budget (the Reserve-Pay cap).
    if input.running_spend_paise.saturating_add(cart.total_paise) > m.budget_total_paise {
        return refuse(RefusalReason::OverCumulativeBudget);
    }
    // 8. AFA — above ₹15,000 needs human approval (not a hard refusal), unless
    //    the human has already approved (the NEEDS_HUMAN resume path).
    if cart.total_paise > AFA_THRESHOLD_PAISE && !input.afa_approved {
        return refuse(RefusalReason::RequiresHumanAFA);
    }

    KernelDecision::Approved(Authorization {
        mandate_id: m.mandate_id,
        cart_hash: cart.cart_hash(),
        amount_paise: cart.total_paise,
    })
}

fn refuse(reason: RefusalReason) -> KernelDecision {
    KernelDecision::Refused(reason)
}

// --- Each bound as a named, independently-testable predicate -----------------

/// True if the mandate is still within its validity window.
pub fn check_ttl(m: &IntentMandate, now: OffsetDateTime) -> bool {
    now <= m.ttl
}

/// True if the cart's claimed total matches its recomputed total, and (when an
/// expected hash is given) the cart hash matches it exactly.
pub fn check_cart_integrity(cart: &Cart, expected_hash: Option<&str>) -> bool {
    if cart.total_paise != cart.recomputed_total() {
        return false;
    }
    match expected_hash {
        Some(h) => cart.cart_hash() == h,
        None => true,
    }
}

/// True if every line item's category is allowed. An empty allow-list means
/// unrestricted on the category axis (the amount caps and TTL still bind).
pub fn check_categories(m: &IntentMandate, cart: &Cart) -> bool {
    if m.allowed_categories.is_empty() {
        return true;
    }
    cart.line_items
        .iter()
        .all(|li| m.allowed_categories.contains(&li.category))
}

/// True if the cart's merchant is allowed. Empty allow-list means unrestricted.
pub fn check_merchant(m: &IntentMandate, cart: &Cart) -> bool {
    if m.allowed_merchants.is_empty() {
        return true;
    }
    m.allowed_merchants.contains(&cart.merchant_id)
}
