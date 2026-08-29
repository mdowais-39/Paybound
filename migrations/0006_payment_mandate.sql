-- AP2 Payment Mandate — closes the third tier of the AP2 mandate chain
-- (Intent -> Cart -> Payment). `domain::PaymentMandate` (crates/domain/src/
-- mandate.rs) has existed since the mandate model was first built, but was
-- never actually constructed anywhere — the information it should carry
-- (authority_ref, agent_present, cart_hash) was only ever scattered across
-- gate_decision's payload and the session->mandate foreign key, never
-- assembled into one first-class record the way intent_mandate and
-- cart_mandate already are.
--
-- One row per payment_effect (1:1 — exactly one payment mandate per real
-- charge attempt), recording the exact authority it was made under and the
-- exact cart it charges, so the full AP2 chain (intent_mandate ->
-- cart_mandate -> payment_mandate) is queryable end to end, not just
-- informally reconstructible.
CREATE TABLE payment_mandate (
    payment_mandate_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    effect_id     UUID NOT NULL REFERENCES payment_effect(effect_id) ON DELETE CASCADE,
    authority_ref UUID NOT NULL REFERENCES intent_mandate(mandate_id), -- the Intent Mandate this charge was authorized under
    agent_present BOOLEAN NOT NULL,                                    -- the orchestrator agent (not a human) drove this checkout; see PaymentMandate's doc comment
    cart_hash     TEXT NOT NULL,                                       -- ties this exact charge to the exact cart the kernel approved
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_payment_mandate_effect ON payment_mandate(effect_id);
CREATE INDEX idx_payment_mandate_authority ON payment_mandate(authority_ref);
