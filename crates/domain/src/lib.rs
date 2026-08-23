//! Shared domain types: money, the state machine, verdicts, and audit event
//! kinds. Pure types with no I/O — used by the kernel (Phase 2), the ledger,
//! and the gateway alike, so the contract can never drift between them.

pub mod money;

pub use money::{Paise, AFA_THRESHOLD_PAISE};

use std::fmt;
use std::str::FromStr;

/// The Purchase Session state machine (Part C). `REFUSED`, `NEEDS_HUMAN`, and
/// `REVOKED` are first-class designed states, not error handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SessionState {
    Delegated,
    Shopping,
    CartBuilt,
    Gating,
    Authorized,
    Paying,
    Completed,
    Refused,
    NeedsHuman,
    Revoked,
}

impl SessionState {
    /// The exact string stored in `purchase_session.state` (matches the DB CHECK).
    pub fn as_db_str(&self) -> &'static str {
        match self {
            SessionState::Delegated => "DELEGATED",
            SessionState::Shopping => "SHOPPING",
            SessionState::CartBuilt => "CART_BUILT",
            SessionState::Gating => "GATING",
            SessionState::Authorized => "AUTHORIZED",
            SessionState::Paying => "PAYING",
            SessionState::Completed => "COMPLETED",
            SessionState::Refused => "REFUSED",
            SessionState::NeedsHuman => "NEEDS_HUMAN",
            SessionState::Revoked => "REVOKED",
        }
    }
}

impl fmt::Display for SessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_db_str())
    }
}

impl FromStr for SessionState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "DELEGATED" => SessionState::Delegated,
            "SHOPPING" => SessionState::Shopping,
            "CART_BUILT" => SessionState::CartBuilt,
            "GATING" => SessionState::Gating,
            "AUTHORIZED" => SessionState::Authorized,
            "PAYING" => SessionState::Paying,
            "COMPLETED" => SessionState::Completed,
            "REFUSED" => SessionState::Refused,
            "NEEDS_HUMAN" => SessionState::NeedsHuman,
            "REVOKED" => SessionState::Revoked,
            other => return Err(format!("unknown session state: {other}")),
        })
    }
}

/// The kernel's verdict as recorded in `gate_decision.verdict`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Verdict {
    Approved,
    Refused,
    NeedsHuman,
}

impl Verdict {
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Verdict::Approved => "approved",
            Verdict::Refused => "refused",
            Verdict::NeedsHuman => "needs_human",
        }
    }
}

/// Audit event kinds — the exact set allowed by `audit_entry.event_type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AuditEventType {
    SessionCreated,
    PreCheckPassed,
    PreCheckFailed,
    WorkerDispatched,
    ConfidenceScored,
    CartBuilt,
    GateDecision,
    TokenIssued,
    PaymentEffect,
    Revoked,
    NarrativeReady,
}

impl AuditEventType {
    pub fn as_db_str(&self) -> &'static str {
        match self {
            AuditEventType::SessionCreated => "session_created",
            AuditEventType::PreCheckPassed => "pre_check_passed",
            AuditEventType::PreCheckFailed => "pre_check_failed",
            AuditEventType::WorkerDispatched => "worker_dispatched",
            AuditEventType::ConfidenceScored => "confidence_scored",
            AuditEventType::CartBuilt => "cart_built",
            AuditEventType::GateDecision => "gate_decision",
            AuditEventType::TokenIssued => "token_issued",
            AuditEventType::PaymentEffect => "payment_effect",
            AuditEventType::Revoked => "revoked",
            AuditEventType::NarrativeReady => "narrative_ready",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_state_roundtrips_through_db_string() {
        for s in [
            SessionState::Delegated,
            SessionState::NeedsHuman,
            SessionState::Revoked,
            SessionState::Completed,
        ] {
            assert_eq!(SessionState::from_str(s.as_db_str()).unwrap(), s);
        }
    }

    #[test]
    fn unknown_state_is_an_error_not_a_panic() {
        assert!(SessionState::from_str("NONSENSE").is_err());
    }
}
