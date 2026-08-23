//! Canonical JSON serialization for the hash-chained audit ledger.
//!
//! Part F non-negotiable #3: every hash-chain write uses canonical
//! (sorted-key) JSON. `serde_json`'s default map ordering is insertion order,
//! which silently breaks `verify_chain` on replay when a payload is
//! re-serialized with a different key order. This module guarantees a stable
//! byte representation by recursively sorting object keys.

use serde_json::{Map, Value};

/// Recursively sort all object keys so the same logical value always produces
/// the same bytes, regardless of how it was constructed.
pub fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for k in keys {
                sorted.insert(k.clone(), canonicalize(&map[k]));
            }
            Value::Object(sorted)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

/// Serialize a value to canonical JSON bytes (sorted keys, no incidental
/// whitespace). This is the exact byte string that feeds the hash chain.
pub fn to_canonical_bytes(value: &Value) -> Vec<u8> {
    // `serde_json::to_vec` on an already key-sorted `Value` is deterministic.
    serde_json::to_vec(&canonicalize(value)).expect("canonical json is infallible for Value")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn same_logical_value_different_key_order_hashes_identically() {
        let a = json!({ "b": 1, "a": 2, "nested": { "y": 1, "x": 2 } });
        let b = json!({ "a": 2, "nested": { "x": 2, "y": 1 }, "b": 1 });
        assert_eq!(to_canonical_bytes(&a), to_canonical_bytes(&b));
    }

    #[test]
    fn arrays_preserve_order() {
        let a = json!([3, 1, 2]);
        let b = json!([1, 2, 3]);
        assert_ne!(to_canonical_bytes(&a), to_canonical_bytes(&b));
    }
}
