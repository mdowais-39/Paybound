//! Razorpay webhook signature verification (HMAC-SHA256).
//!
//! CRITICAL (Part F, Phase 4): verify against the RAW request body bytes, never
//! a re-serialized copy — re-serialization reorders/reformats JSON and breaks
//! the signature. The comparison is constant-time to avoid a timing oracle.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Verify `X-Razorpay-Signature` (hex) over the raw webhook body using the
/// webhook secret. Returns true iff the signature matches.
pub fn verify_webhook_signature(secret: &str, raw_body: &[u8], signature_hex: &str) -> bool {
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(raw_body);
    let expected = mac.finalize().into_bytes();
    match hex::decode(signature_hex) {
        Ok(sig) => {
            // constant-time compare via HMAC's built-in verify
            let mut mac2 = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
            mac2.update(raw_body);
            mac2.verify_slice(&sig).is_ok() && !expected.is_empty()
        }
        Err(_) => false,
    }
}

/// Compute the hex HMAC-SHA256 of a body — used by tests (and any tooling that
/// needs to sign a synthetic webhook exactly as Razorpay would).
pub fn sign_webhook(secret: &str, raw_body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(raw_body);
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_signature_verifies_and_tamper_fails() {
        let secret = "whsec_test_123";
        let body = br#"{"event":"payment_link.paid","payload":{"amount":50800}}"#;
        let sig = sign_webhook(secret, body);
        assert!(verify_webhook_signature(secret, body, &sig));

        // Wrong secret, tampered body, and garbage signature all fail.
        assert!(!verify_webhook_signature("whsec_wrong", body, &sig));
        let tampered = br#"{"event":"payment_link.paid","payload":{"amount":99999}}"#;
        assert!(!verify_webhook_signature(secret, tampered, &sig));
        assert!(!verify_webhook_signature(secret, body, "deadbeef"));
    }
}
