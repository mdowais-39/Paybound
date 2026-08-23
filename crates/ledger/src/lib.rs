//! Postgres repositories (sqlx, compile-time-checked) + the hash-chained audit
//! ledger. This is the non-repudiation backbone: every money-relevant step is
//! appended as a tamper-evident, hash-linked entry keyed to a purchase session.

pub mod audit;
pub mod hash;
pub mod repos;

pub use audit::{AuditEntry, AuditLedger};

/// The database pool type used across repositories.
pub type Db = sqlx::PgPool;

use common::AppError;

/// Map a sqlx error into the app-wide error type.
pub(crate) fn db_err(e: sqlx::Error) -> AppError {
    AppError::Internal(format!("db: {e}"))
}
