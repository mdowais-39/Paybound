-- Phase 10 hardening.

-- A delegated token is scoped and SINGLE-USE: it backs exactly one payment
-- effect. This constraint makes a token replay a hard DB error, not a policy.
ALTER TABLE payment_effect
    ADD CONSTRAINT payment_effect_delegated_token_key UNIQUE (delegated_token);

-- Webhook replay protection: every delivered webhook body is recorded once
-- (keyed by its SHA-256), so a replayed/duplicate delivery is detected and
-- ignored rather than re-processed.
CREATE TABLE webhook_event (
    body_sha256 TEXT PRIMARY KEY,
    event_type  TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
