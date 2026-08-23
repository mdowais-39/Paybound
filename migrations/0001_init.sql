-- Paybound data model — the 9 entities that ARE the contract (Part C).
-- Money is ALWAYS integer paise in a BIGINT column (Part F #4): never float/decimal.
-- The audit_entry table is an append-only, hash-chained, tamper-evident ledger.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. merchant — the agent-transactable seller (stays merchant-of-record).
CREATE TABLE merchant (
    merchant_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    allowed_methods JSONB NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["upi","card"]
    ard_manifest    JSONB,                                -- .well-known/agents.txt authority decl.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. catalog_item — what the agent shops. price_paise is INTEGER PAISE.
CREATE TABLE catalog_item (
    item_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id   UUID NOT NULL REFERENCES merchant(merchant_id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    category      TEXT NOT NULL,
    price_paise   BIGINT NOT NULL CHECK (price_paise >= 0),
    currency      TEXT NOT NULL DEFAULT 'INR',
    availability  BOOLEAN NOT NULL DEFAULT true,
    variants      JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{size,color,sku,price_paise}]
    embedding     vector(384),                            -- populated in Phase 7 (search relevance)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalog_item_merchant ON catalog_item(merchant_id);
CREATE INDEX idx_catalog_item_category ON catalog_item(category);

-- 3. intent_mandate — the signed, bounded envelope (AP2 Intent Mandate).
CREATE TABLE intent_mandate (
    mandate_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payer              TEXT NOT NULL,
    budget_total_paise BIGINT NOT NULL CHECK (budget_total_paise >= 0),
    per_txn_cap_paise  BIGINT NOT NULL CHECK (per_txn_cap_paise >= 0),
    allowed_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_merchants  JSONB NOT NULL DEFAULT '[]'::jsonb,
    ttl                TIMESTAMPTZ NOT NULL,               -- expiry of the authority
    nl_goal            TEXT NOT NULL,                      -- natural-language playback
    public_key         TEXT NOT NULL,                      -- ed25519 verifying key (hex)
    signature          TEXT NOT NULL,                      -- ed25519 signature over canonical bytes (hex)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. purchase_session — the aggregate root, bound to a mandate.
CREATE TABLE purchase_session (
    session_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mandate_id         UUID NOT NULL REFERENCES intent_mandate(mandate_id),
    state              TEXT NOT NULL DEFAULT 'DELEGATED',
    running_spend_paise BIGINT NOT NULL DEFAULT 0 CHECK (running_spend_paise >= 0),
    confidence_score   DOUBLE PRECISION,                   -- nullable; set by the Confidence Scorer (Phase 7)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_session_state CHECK (state IN
        ('DELEGATED','SHOPPING','CART_BUILT','GATING','AUTHORIZED','PAYING',
         'COMPLETED','REFUSED','NEEDS_HUMAN','REVOKED'))
);
CREATE INDEX idx_session_mandate ON purchase_session(mandate_id);

-- 5. cart_mandate — the exact authorized cart (AP2 Cart Mandate), hash-chained to intent.
CREATE TABLE cart_mandate (
    cart_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id  UUID NOT NULL REFERENCES purchase_session(session_id) ON DELETE CASCADE,
    line_items  JSONB NOT NULL,                            -- [{item_id,qty,price_paise,category}]
    total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
    merchant_id UUID NOT NULL REFERENCES merchant(merchant_id),
    intent_hash TEXT NOT NULL,                             -- ties this cart to its intent mandate
    signature   TEXT,                                      -- optional ed25519 signature
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cart_session ON cart_mandate(session_id);

-- 6. gate_decision — proves the kernel ran on every buy.
CREATE TABLE gate_decision (
    decision_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id   UUID NOT NULL REFERENCES purchase_session(session_id) ON DELETE CASCADE,
    cart_id      UUID REFERENCES cart_mandate(cart_id),
    verdict      TEXT NOT NULL,                            -- 'approved' | 'refused' | 'needs_human'
    rule_cited   TEXT,                                     -- the RefusalReason, when refused
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_verdict CHECK (verdict IN ('approved','refused','needs_human'))
);
CREATE INDEX idx_gate_session ON gate_decision(session_id);

-- 7. reserve_block — the SIMULATED Reserve-Pay fund-block + cumulative cap.
-- SIMULATED: Razorpay exposes no public Reserve-Pay API; this is a ledger model (Part F #7).
CREATE TABLE reserve_block (
    block_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mandate_id            UUID NOT NULL REFERENCES intent_mandate(mandate_id),
    merchant_id           UUID NOT NULL REFERENCES merchant(merchant_id),
    reserved_amount_paise BIGINT NOT NULL CHECK (reserved_amount_paise >= 0),
    debited_amount_paise  BIGINT NOT NULL DEFAULT 0 CHECK (debited_amount_paise >= 0),
    status                TEXT NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_reserve_status CHECK (status IN ('active','released','revoked')),
    CONSTRAINT chk_debit_within_reserve CHECK (debited_amount_paise <= reserved_amount_paise)
);
CREATE INDEX idx_reserve_mandate ON reserve_block(mandate_id);

-- 8. payment_effect — the money ledger (real Razorpay test-mode calls).
CREATE TABLE payment_effect (
    effect_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES purchase_session(session_id) ON DELETE CASCADE,
    razorpay_ref    TEXT,                                  -- order_/pay_/plink_ id
    delegated_token TEXT,                                  -- scoped, single-use token
    idempotency_key TEXT NOT NULL UNIQUE,                  -- every money call carries one (Part F #5)
    amount_paise    BIGINT NOT NULL CHECK (amount_paise >= 0),
    outcome         TEXT NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_payment_outcome CHECK (outcome IN ('pending','success','failed'))
);
CREATE INDEX idx_payment_session ON payment_effect(session_id);

-- 9. audit_entry — append-only, hash-chained, tamper-evident non-repudiation record.
-- this_hash = SHA256(prev_hash || canonical_json(payload) || event_type || ts).
-- `seq` gives a deterministic per-session walk order for verify_chain.
CREATE TABLE audit_entry (
    entry_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seq        BIGSERIAL NOT NULL,
    session_id UUID NOT NULL REFERENCES purchase_session(session_id) ON DELETE CASCADE,
    prev_hash  TEXT,                                       -- NULL for the genesis entry of a session
    this_hash  TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload    JSONB NOT NULL,
    narrative  TEXT,                                       -- plain-language justification (Phase 9)
    ts         TIMESTAMPTZ NOT NULL,                       -- the exact ts folded into this_hash
    CONSTRAINT chk_event_type CHECK (event_type IN
        ('session_created','pre_check_passed','pre_check_failed','worker_dispatched',
         'confidence_scored','cart_built','gate_decision','token_issued','payment_effect',
         'revoked','narrative_ready'))
);
CREATE INDEX idx_audit_session_seq ON audit_entry(session_id, seq);
