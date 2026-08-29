-- Campaign orchestrator: an append-only read-model log for in-app win-back /
-- cross-sell nudges, mirroring the precedent set by agent_run (0005_runs.sql)
-- -- written directly by the Python agent-api, not money-critical, so it
-- doesn't go through Rust/the kernel. The engine that produces these rows
-- never touches money itself; it only ever proposes a natural-language goal
-- the human can accept (which is then handed to the ordinary, fully
-- kernel-gated /run pipeline) or dismiss.
CREATE TABLE campaign_offer (
    offer_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mandate_id     UUID NOT NULL REFERENCES intent_mandate(mandate_id) ON DELETE CASCADE,
    campaign_type  TEXT NOT NULL,                    -- 'complete_the_set' | 'win_back'
    reason         TEXT NOT NULL,                    -- human-readable, grounded in real data
    suggested_goal TEXT NOT NULL,                    -- natural-language goal to prefill on accept
    item_id        UUID,                             -- the specific catalog item, when rule-specific
    status         TEXT NOT NULL DEFAULT 'shown',     -- 'shown' | 'accepted' | 'dismissed'
    shown_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ,
    CONSTRAINT chk_campaign_offer_status CHECK (status IN ('shown', 'accepted', 'dismissed'))
);
CREATE INDEX idx_campaign_offer_mandate ON campaign_offer(mandate_id, shown_at DESC);
