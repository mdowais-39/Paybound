//! Shared foundations for the Paybound Rust core: errors, config, telemetry,
//! ed25519 mandate signing, and canonical JSON for the hash-chained ledger.

pub mod canonical;
pub mod config;
pub mod error;
pub mod signing;
pub mod telemetry;

pub use error::AppError;

/// A convenience result type used across the Rust core.
pub type Result<T> = std::result::Result<T, AppError>;
