//! The typed outcomes of the kernel. A refusal is never a bare error — it
//! carries the exact rule that fired, which becomes `gate_decision.rule_cited`
//! and drives the graceful-refusal UX.

use domain::Verdict;

/// Every way the kernel can decline to approve a cart as-proposed. `RequiresHumanAFA`
/// is special: it is not a hard refusal but a route to human approval (the ₹15,000
/// AFA gate), so it maps to the `needs_human` verdict rather than `refused`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalReason {
    /// The Intent Mandate's signature does not verify against its public key.
    SignatureInvalid,
    /// The mandate's TTL has passed.
    MandateExpired,
    /// Cart total exceeds the mandate's per-transaction ceiling.
    OverPerTxnCap,
    /// Running spend + this cart would exceed the total budget (Reserve-Pay cap).
    OverCumulativeBudget,
    /// A line item's category is outside the mandate's allow-list.
    CategoryNotAllowed,
    /// The cart's merchant is outside the mandate's allow-list.
    MerchantNotAllowed,
    /// The cart's claimed total or hash does not match its contents (price drift
    /// / item substitution).
    CartIntegrityMismatch,
    /// Cart is within the mandate but above the ₹15,000 AFA threshold — needs a
    /// human PIN-equivalent approval before it can proceed.
    RequiresHumanAFA,
    /// The human revoked this mandate's authority; nothing more can be spent.
    MandateRevoked,
}

impl RefusalReason {
    /// The DB verdict this reason produces. `RequiresHumanAFA` is `needs_human`;
    /// everything else is a hard `refused`.
    pub fn verdict(&self) -> Verdict {
        match self {
            RefusalReason::RequiresHumanAFA => Verdict::NeedsHuman,
            _ => Verdict::Refused,
        }
    }

    /// Stable machine string stored in `gate_decision.rule_cited`.
    pub fn as_str(&self) -> &'static str {
        match self {
            RefusalReason::SignatureInvalid => "signature_invalid",
            RefusalReason::MandateExpired => "mandate_expired",
            RefusalReason::OverPerTxnCap => "over_per_txn_cap",
            RefusalReason::OverCumulativeBudget => "over_cumulative_budget",
            RefusalReason::CategoryNotAllowed => "category_not_allowed",
            RefusalReason::MerchantNotAllowed => "merchant_not_allowed",
            RefusalReason::CartIntegrityMismatch => "cart_integrity_mismatch",
            RefusalReason::RequiresHumanAFA => "requires_human_afa",
            RefusalReason::MandateRevoked => "mandate_revoked",
        }
    }

    /// A plain-language explanation (the human-facing half of the refusal).
    pub fn human_message(&self) -> &'static str {
        match self {
            RefusalReason::SignatureInvalid => "The authorization could not be verified.",
            RefusalReason::MandateExpired => "This authorization has expired.",
            RefusalReason::OverPerTxnCap => {
                "This purchase exceeds the per-transaction limit you set."
            }
            RefusalReason::OverCumulativeBudget => {
                "This purchase would exceed the total budget you set."
            }
            RefusalReason::CategoryNotAllowed => {
                "This item is outside the categories you authorized."
            }
            RefusalReason::MerchantNotAllowed => "This merchant is not in your authorized list.",
            RefusalReason::CartIntegrityMismatch => {
                "The cart changed from what was authorized (price or items)."
            }
            RefusalReason::RequiresHumanAFA => {
                "This purchase is above ₹15,000 and needs your approval."
            }
            RefusalReason::MandateRevoked => "You revoked this authorization.",
        }
    }
}
