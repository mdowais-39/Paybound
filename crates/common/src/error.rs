//! The single error type for the Paybound Rust core.

use thiserror::Error;

/// Application-wide error. Money- and crypto-path callers should map these to
/// typed, auditable outcomes rather than letting them escape as opaque 500s.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(String),

    #[error("signature error: {0}")]
    Signature(String),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("internal error: {0}")]
    Internal(String),
}
