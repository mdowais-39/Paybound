-- Console run history: one durable row per agent run issued from the shopping
-- console. A "run" is a single natural-language goal driven to a terminal
-- orchestrator state (COMPLETED / AUTHORIZED / REFUSED / NEEDS_HUMAN / CLARIFY
-- / CHOOSE / PRE_CHECK_FAILED). It references the SHARED purchase_session — a
-- run is deliberately NOT a session: spend and budget stay session-scoped and
-- kernel-enforced, so recording runs never touches the money model. The row
-- stores the goal text plus the full OrchestratorResult snapshot, so the
-- console rebuilds its cards faithfully from the database across devices and
-- cache clears instead of from per-browser localStorage.
--
-- This is an append-only orchestration LOG, not a money/state mutation: the
-- authoritative gate/payment/audit records remain gate_decision,
-- payment_effect, and the hash-chained audit_entry — all written by the Rust
-- services behind the kernel. `agent_run` is a denormalized read model for the
-- UI, written by the agent API as each run reaches its terminal state.
CREATE TABLE agent_run (
    run_id       TEXT PRIMARY KEY,                    -- client idempotency key; stable across a run's run→select→approve steps
    session_id   UUID NOT NULL REFERENCES purchase_session(session_id) ON DELETE CASCADE,
    mandate_id   UUID NOT NULL REFERENCES intent_mandate(mandate_id) ON DELETE CASCADE,
    goal         TEXT NOT NULL,                       -- the natural-language goal the human typed
    state        TEXT NOT NULL,                       -- terminal orchestrator state
    verdict      TEXT,                                -- kernel verdict when the run reached the gate
    rule_cited   TEXT,                                -- the refusal reason, when refused
    cart_id      TEXT,                                -- composed cart, when one was built
    total_paise  BIGINT NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
    message      TEXT,                                -- human-readable outcome / clarify message
    payment_link TEXT,                                -- the payment link, when a purchase was authorized
    result_json  JSONB NOT NULL,                      -- full OrchestratorResult snapshot for faithful UI rebuild
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_run_mandate ON agent_run(mandate_id, created_at DESC);
CREATE INDEX idx_run_session ON agent_run(session_id);
