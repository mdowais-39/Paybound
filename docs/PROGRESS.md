# Paybound — Progress Log

Phase completions with test results. A phase is only "done" when its STOP-AND-TEST
block passes and is shown.

## Phase 0 — Foundations & scaffolding — ✅ DONE

**Built (credential-independent):**
- Cargo workspace with all 9 crates; Python service tree; `proto/ migrations/ data/ workflows/ eval/ deploy/ docs/`.
- `common` crate: `error` (AppError), `config` (figment), `telemetry` (OTLP→Tempo→Grafana, degrades to logs-only), `signing` (ed25519 sign/verify over canonical bytes), `canonical` (sorted-key JSON for the hash chain).
- `gateway` crate: axum server, `/health`, `TraceLayer` middleware.
- Stub libs for domain/ledger/reserve/kernel/razorpay-client/execution/storefront-mcp (fleshed out in their phases).
- `deploy/docker-compose.yml` (Postgres 16, Redis, OTel Collector, Tempo, Grafana; Temporal behind `workflow` profile) + collector/tempo/grafana configs.
- CI: `.github/workflows/ci.yml` (cargo fmt/clippy/test + ruff/pytest).
- `.gitignore`, `.env.example`, `requirements.txt`, `pyproject.toml`, Python smoke test.

**Test results so far (local, credential-independent):**
- `cargo check --workspace` → clean (all 9 crates compile).
- `cargo test -p common` → **6 passed** (canonical key-order invariance, sign/verify roundtrip, tamper rejection, config defaults).
- `cargo clippy --workspace` → clean, no warnings. `cargo fmt --check` → clean.
- `ruff check services` → clean; `pytest services` → **2 passed** (in the `paybound` conda env).
- `docker compose config` → compose file valid.
- **git:** independent repo initialised at `paybound/`, first commit `fdc4d21` (53 files, no secrets/`target/` staged). Remote pending the GitHub URL.

**STOP-AND-TEST results:**
- [x] `docker compose up` → all 5 core services up (Postgres & Redis healthy, Collector/Tempo/Grafana running).
- [x] `/health` → HTTP 200; trace exported gateway → OTLP → collector (5 spans) → **Tempo returns it** (`rootServiceName=paybound-gateway`, `rootTraceName=health`), so it's visible in Grafana (Tempo datasource). See DECISIONS.md for the TraceLayer-level fix.
- [x] Public repo pushed (github.com/mdowais-39/Paybound); **CI green** on commit `de96d3c` (success).
- [x] Razorpay test-mode auth: `GET /v1/payments` → 200; `POST /v1/orders` → 200 (created `order_TTGqUpGI9mtotK`, ₹500 = 50000 paise). Read + write both confirmed on the test rail, de-risking Phase 4.

**Phase 0 DONE.** All four STOP-AND-TEST checks pass. (LLM API key deferred — not needed until Phase 6; does not block Phases 1–5.)

## Phase 1 — Data layer & the audit ledger — ✅ DONE

**Built:**
- `migrations/0001_init.sql` — all 9 entities (merchant, catalog_item, intent_mandate, purchase_session, cart_mandate, gate_decision, reserve_block, payment_effect, audit_entry) + `vector`/`uuid-ossp` extensions. Money is BIGINT paise with CHECK constraints; state/verdict/event_type constrained to the exact enums.
- `domain` crate — `SessionState`, `Verdict`, `AuditEventType` (with DB-string round-trip), `Paise` type + `AFA_THRESHOLD_PAISE` (₹15,000 = 1,500,000).
- `ledger` crate — compile-time-checked sqlx repos (`create_merchant/intent_mandate/session`, `get_session_state`) + the hash-chained audit ledger (`append`, `list_chain`, `verify_chain`). Canonical sorted-key JSON payloads; timestamp folded as unix-microseconds for exact round-trip.
- `data/ingest_abo.py` — ingests 1000 curated ABO products (prices synthesized, seeded).
- CI updated: Postgres service container + collation refresh; build offline via committed `.sqlx` cache, tests run against the service.

**STOP-AND-TEST results:**
- [x] Migrations apply cleanly — `sqlx migrate run` → `Applied 1/migrate init`; 9 tables present.
- [x] Append 5 audit entries + `verify_chain` passes; tampering entry 3's payload → `verify_chain` fails; rewriting a stored hash → fails. (`cargo test -p ledger` → **5 passed**: 2 pure hash + 3 integration.)
- [x] Catalog holds ingested products with ₹ prices — `SELECT` returns 1000 items, 144 categories, ₹439–₹14,356.
- Full workspace: **15 tests pass** (common 6, domain 4, ledger 5); offline `fmt`+`clippy -D warnings` clean.
