-- Instant revocation: a human can kill an Intent Mandate's authority at any
-- moment. Once revoked, the kernel refuses every subsequent purchase against it.
ALTER TABLE intent_mandate ADD COLUMN revoked_at TIMESTAMPTZ;
