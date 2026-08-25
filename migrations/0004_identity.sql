-- Lightweight bearer-token identity, so mandates have a real owner instead of
-- anyone-can-touch-anything. `POST /identity` mints a token and returns it
-- ONCE (only its SHA-256 hash is ever stored — the raw token can't be
-- recovered from the DB, standard bearer-token bootstrapping). Every mandate
-- created while presenting a token is stamped with that token's hash, and the
-- gateway/agent API check it on every read or action against that mandate's
-- sessions (list, get, revoke, run, approve).
CREATE TABLE identity (
    token_hash TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE intent_mandate ADD COLUMN owner_token_hash TEXT REFERENCES identity(token_hash);
CREATE INDEX idx_intent_mandate_owner ON intent_mandate(owner_token_hash);
