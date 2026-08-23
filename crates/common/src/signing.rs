//! ed25519 mandate signing and verification.
//!
//! Scoped deliberately to software asymmetric keys (ed25519), not FIDO-grade
//! hardware-backed device keys: the non-repudiation *chain* is what matters for
//! the buildathon, and this is stated openly in the docs. The pattern —
//! sign the canonical bytes of a mandate, verify before the kernel trusts it —
//! is identical to what a hardware-backed implementation would do.

use crate::canonical::to_canonical_bytes;
use crate::error::AppError;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::Value;

/// Generate a fresh ed25519 signing keypair.
pub fn generate_keypair() -> SigningKey {
    let mut csprng = rand::rngs::OsRng;
    SigningKey::generate(&mut csprng)
}

/// Sign the canonical JSON bytes of a value, returning a hex-encoded signature.
pub fn sign_value(key: &SigningKey, value: &Value) -> String {
    let bytes = to_canonical_bytes(value);
    let sig = key.sign(&bytes);
    hex::encode(sig.to_bytes())
}

/// Verify a hex-encoded signature over the canonical bytes of a value.
pub fn verify_value(
    verifying_key: &VerifyingKey,
    value: &Value,
    signature_hex: &str,
) -> Result<(), AppError> {
    let sig_bytes =
        hex::decode(signature_hex).map_err(|e| AppError::Signature(format!("invalid hex: {e}")))?;
    let sig_arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| AppError::Signature("signature must be 64 bytes".into()))?;
    let sig = Signature::from_bytes(&sig_arr);
    let bytes = to_canonical_bytes(value);
    verifying_key
        .verify(&bytes, &sig)
        .map_err(|e| AppError::Signature(format!("verification failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sign_then_verify_roundtrips() {
        let key = generate_keypair();
        let vk = key.verifying_key();
        let mandate = json!({ "budget_total": 300000, "nl_goal": "running shoes under 3000" });
        let sig = sign_value(&key, &mandate);
        assert!(verify_value(&vk, &mandate, &sig).is_ok());
    }

    #[test]
    fn tampered_payload_fails_verification() {
        let key = generate_keypair();
        let vk = key.verifying_key();
        let mandate = json!({ "budget_total": 300000 });
        let sig = sign_value(&key, &mandate);
        let tampered = json!({ "budget_total": 999999 });
        assert!(verify_value(&vk, &tampered, &sig).is_err());
    }

    #[test]
    fn key_order_does_not_affect_verification() {
        let key = generate_keypair();
        let vk = key.verifying_key();
        let signed = json!({ "a": 1, "b": 2 });
        let sig = sign_value(&key, &signed);
        let reordered = json!({ "b": 2, "a": 1 });
        assert!(verify_value(&vk, &reordered, &sig).is_ok());
    }
}
