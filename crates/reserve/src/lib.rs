//! Reserve-Pay ledger — the **SIMULATED** UPI fund-block.
//!
//! Razorpay exposes no public Reserve-Pay API, so we model it ourselves as a
//! ledger primitive (Part F #7): a block of funds reserved against a merchant
//! with a ceiling, debited by successive approved carts (Single-Block-Multi-
//! Debit), releasable/revocable instantly. This is where the cumulative cap
//! lives and is the primitive the kernel checks against.
//!
//! The logic here is pure (no I/O) so its central invariant — **debits can
//! never exceed the reserved ceiling** — is exhaustively testable.

use domain::Paise;

/// Lifecycle of a reserve block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveStatus {
    Active,
    Released,
    Revoked,
}

impl ReserveStatus {
    pub fn as_db_str(&self) -> &'static str {
        match self {
            ReserveStatus::Active => "active",
            ReserveStatus::Released => "released",
            ReserveStatus::Revoked => "revoked",
        }
    }
}

/// Why a debit was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveError {
    /// The block has been revoked (human killed the authority).
    Revoked,
    /// The block has been released.
    Released,
    /// This debit would push cumulative debits past the reserved ceiling.
    WouldExceedCeiling,
    /// A debit amount must be positive.
    NonPositiveAmount,
}

/// A reserved fund-block. `debited` never exceeds `reserved` — enforced by
/// `debit`, which is the only way to increase it.
#[derive(Debug, Clone, Copy)]
pub struct ReserveBlock {
    reserved_paise: Paise,
    debited_paise: Paise,
    status: ReserveStatus,
}

impl ReserveBlock {
    /// Create a new active block reserving `reserved_paise`.
    pub fn new(reserved_paise: Paise) -> Self {
        Self {
            reserved_paise,
            debited_paise: 0,
            status: ReserveStatus::Active,
        }
    }

    /// Reconstruct from persisted values (used by the DB-backed repo).
    pub fn from_parts(reserved_paise: Paise, debited_paise: Paise, status: ReserveStatus) -> Self {
        Self {
            reserved_paise,
            debited_paise,
            status,
        }
    }

    pub fn reserved_paise(&self) -> Paise {
        self.reserved_paise
    }
    pub fn debited_paise(&self) -> Paise {
        self.debited_paise
    }
    pub fn status(&self) -> ReserveStatus {
        self.status
    }

    /// Funds still available to debit (0 if not active).
    pub fn available(&self) -> Paise {
        if self.status == ReserveStatus::Active {
            self.reserved_paise - self.debited_paise
        } else {
            0
        }
    }

    /// Debit `amount` against the block. Enforces the ceiling invariant and the
    /// active status. This is Single-Block-Multi-Debit: many debits, one block,
    /// cumulative total capped.
    pub fn debit(&mut self, amount: Paise) -> Result<(), ReserveError> {
        if amount <= 0 {
            return Err(ReserveError::NonPositiveAmount);
        }
        match self.status {
            ReserveStatus::Revoked => return Err(ReserveError::Revoked),
            ReserveStatus::Released => return Err(ReserveError::Released),
            ReserveStatus::Active => {}
        }
        if self.debited_paise + amount > self.reserved_paise {
            return Err(ReserveError::WouldExceedCeiling);
        }
        self.debited_paise += amount;
        Ok(())
    }

    /// Release the block (normal close). Further debits are rejected.
    pub fn release(&mut self) {
        if self.status == ReserveStatus::Active {
            self.status = ReserveStatus::Released;
        }
    }

    /// Revoke the block instantly (the human kills the authority). Idempotent.
    pub fn revoke(&mut self) {
        self.status = ReserveStatus::Revoked;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_debit_within_ceiling_succeeds() {
        let mut b = ReserveBlock::new(300_000);
        assert!(b.debit(100_000).is_ok());
        assert!(b.debit(150_000).is_ok());
        assert_eq!(b.debited_paise(), 250_000);
        assert_eq!(b.available(), 50_000);
    }

    #[test]
    fn debit_breaching_ceiling_is_rejected_and_state_unchanged() {
        let mut b = ReserveBlock::new(300_000);
        b.debit(250_000).unwrap();
        assert_eq!(b.debit(100_000), Err(ReserveError::WouldExceedCeiling));
        assert_eq!(b.debited_paise(), 250_000); // unchanged by the rejected debit
    }

    #[test]
    fn revoke_blocks_further_debits() {
        let mut b = ReserveBlock::new(300_000);
        b.revoke();
        assert_eq!(b.debit(1), Err(ReserveError::Revoked));
        assert_eq!(b.available(), 0);
    }

    #[test]
    fn non_positive_debit_rejected() {
        let mut b = ReserveBlock::new(300_000);
        assert_eq!(b.debit(0), Err(ReserveError::NonPositiveAmount));
        assert_eq!(b.debit(-5), Err(ReserveError::NonPositiveAmount));
    }

    /// Property test: for ANY sequence of debit attempts, cumulative debits can
    /// never exceed the reserved ceiling. This is the ledger's core guarantee.
    #[test]
    fn property_debits_never_breach_ceiling() {
        let ceiling: Paise = 1_000_000;
        // A deterministic spread of amounts, many of which would overshoot.
        let amounts = [
            1, 999_999, 1, 2, 500_000, 500_000, 500_001, 250_000, 250_000, 250_001, 0, -100,
            1_000_000, 999_998,
        ];
        for start in 0..amounts.len() {
            let mut b = ReserveBlock::new(ceiling);
            for &a in amounts.iter().cycle().skip(start).take(40) {
                let _ = b.debit(a); // ignore individual outcomes
                assert!(
                    b.debited_paise() <= b.reserved_paise(),
                    "invariant violated: debited {} > reserved {}",
                    b.debited_paise(),
                    b.reserved_paise()
                );
            }
        }
    }
}
