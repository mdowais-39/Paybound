//! The append-only, hash-chained audit ledger.

use crate::hash::compute_entry_hash;
use crate::{db_err, Db};
use common::AppError;
use domain::AuditEventType;
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

/// One row of the audit chain.
#[derive(Debug, Clone)]
pub struct AuditEntry {
    pub entry_id: Uuid,
    pub seq: i64,
    pub session_id: Uuid,
    pub prev_hash: Option<String>,
    pub this_hash: String,
    pub event_type: String,
    pub payload: Value,
    pub narrative: Option<String>,
    pub ts: OffsetDateTime,
}

/// Fold a timestamp into the exact integer used in the hash: unix microseconds.
/// Postgres `timestamptz` keeps microsecond precision, so this round-trips
/// identically on read (see `hash.rs`).
fn ts_micros(ts: OffsetDateTime) -> i64 {
    (ts.unix_timestamp_nanos() / 1000) as i64
}

/// The audit ledger, backed by a Postgres pool.
pub struct AuditLedger<'a> {
    pool: &'a Db,
}

impl<'a> AuditLedger<'a> {
    pub fn new(pool: &'a Db) -> Self {
        Self { pool }
    }

    /// Append an entry, chaining it to the session's latest entry. Runs in a
    /// transaction so the prev-hash read and the insert are atomic.
    pub async fn append(
        &self,
        session_id: Uuid,
        event_type: AuditEventType,
        payload: Value,
    ) -> Result<AuditEntry, AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;

        let prev_hash: Option<String> = sqlx::query_scalar!(
            "SELECT this_hash FROM audit_entry WHERE session_id = $1 ORDER BY seq DESC LIMIT 1",
            session_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;

        // Sourced from Postgres's own clock, NOT the Rust process's host clock
        // (`OffsetDateTime::now_utc()`). The frontend attributes each audit
        // entry to a console run by comparing this `ts` against `agent_run.
        // updated_at` — which the Python API sets via SQL `now()`, i.e.
        // Postgres's clock. If Rust stamped `ts` from the host instead, any
        // drift between the host and the (often containerized) Postgres clock
        // — real and measured at ~1s on this stack — lets a run's own late
        // audit entries fall outside its own window and get misattributed to
        // an unrelated cart. Same clock on both sides removes the drift
        // entirely rather than papering over it with a tolerance window.
        let ts: OffsetDateTime = sqlx::query_scalar!(r#"SELECT now() AS "ts!""#)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        let et = event_type.as_db_str();
        let this_hash = compute_entry_hash(prev_hash.as_deref(), et, &payload, ts_micros(ts));

        let rec = sqlx::query!(
            "INSERT INTO audit_entry (session_id, prev_hash, this_hash, event_type, payload, ts)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING entry_id, seq",
            session_id,
            prev_hash,
            this_hash,
            et,
            payload,
            ts,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;

        tx.commit().await.map_err(db_err)?;

        Ok(AuditEntry {
            entry_id: rec.entry_id,
            seq: rec.seq,
            session_id,
            prev_hash,
            this_hash,
            event_type: et.to_string(),
            payload,
            narrative: None,
            ts,
        })
    }

    /// Return the full chain for a session, in append order.
    pub async fn list_chain(&self, session_id: Uuid) -> Result<Vec<AuditEntry>, AppError> {
        let rows = sqlx::query!(
            "SELECT entry_id, seq, session_id, prev_hash, this_hash, event_type,
                    payload, narrative, ts
             FROM audit_entry WHERE session_id = $1 ORDER BY seq ASC",
            session_id
        )
        .fetch_all(self.pool)
        .await
        .map_err(db_err)?;

        Ok(rows
            .into_iter()
            .map(|r| AuditEntry {
                entry_id: r.entry_id,
                seq: r.seq,
                session_id: r.session_id,
                prev_hash: r.prev_hash,
                this_hash: r.this_hash,
                event_type: r.event_type,
                payload: r.payload,
                narrative: r.narrative,
                ts: r.ts,
            })
            .collect())
    }

    /// Walk the chain and confirm every link: each entry's `prev_hash` must
    /// equal the previous entry's `this_hash`, and each `this_hash` must equal
    /// the hash recomputed from its stored contents. Any tamper breaks it.
    pub async fn verify_chain(&self, session_id: Uuid) -> Result<bool, AppError> {
        let entries = self.list_chain(session_id).await?;
        let mut expected_prev: Option<String> = None;

        for e in &entries {
            if e.prev_hash.as_deref() != expected_prev.as_deref() {
                return Ok(false);
            }
            let recomputed = compute_entry_hash(
                e.prev_hash.as_deref(),
                &e.event_type,
                &e.payload,
                ts_micros(e.ts),
            );
            if recomputed != e.this_hash {
                return Ok(false);
            }
            expected_prev = Some(e.this_hash.clone());
        }
        Ok(true)
    }
}
