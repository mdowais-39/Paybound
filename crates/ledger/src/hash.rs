//! The pure hash-chain primitive for the audit ledger.
//!
//! `this_hash = SHA256(prev_hash || canonical_json(payload) || event_type || ts)`
//!
//! Two determinism guarantees make `verify_chain` reliable on replay:
//!   1. `payload` is hashed via canonical (sorted-key) JSON (Part F #3), so key
//!      order can never change the hash.
//!   2. The timestamp is folded in as **unix microseconds (i64)**, not a
//!      formatted string — Postgres `timestamptz` keeps microsecond precision,
//!      so an integer derived from `unix_nanos / 1000` round-trips exactly,
//!      whereas an RFC3339 string could drift on the nanos→micros truncation.

use common::canonical::to_canonical_bytes;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Compute one audit entry's hash. Pure: identical inputs always yield the
/// identical hash, on any machine, at any time.
pub fn compute_entry_hash(
    prev_hash: Option<&str>,
    event_type: &str,
    payload: &Value,
    ts_unix_micros: i64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.unwrap_or("").as_bytes());
    hasher.update(to_canonical_bytes(payload));
    hasher.update(event_type.as_bytes());
    hasher.update(ts_unix_micros.to_le_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn key_order_does_not_change_the_hash() {
        let a = compute_entry_hash(None, "gate_decision", &json!({"a":1,"b":2}), 1_000);
        let b = compute_entry_hash(None, "gate_decision", &json!({"b":2,"a":1}), 1_000);
        assert_eq!(a, b);
    }

    #[test]
    fn any_field_change_changes_the_hash() {
        let base = compute_entry_hash(Some("prev"), "gate_decision", &json!({"v":1}), 1_000);
        assert_ne!(
            base,
            compute_entry_hash(Some("other"), "gate_decision", &json!({"v":1}), 1_000)
        );
        assert_ne!(
            base,
            compute_entry_hash(Some("prev"), "payment_effect", &json!({"v":1}), 1_000)
        );
        assert_ne!(
            base,
            compute_entry_hash(Some("prev"), "gate_decision", &json!({"v":2}), 1_000)
        );
        assert_ne!(
            base,
            compute_entry_hash(Some("prev"), "gate_decision", &json!({"v":1}), 1_001)
        );
    }
}
