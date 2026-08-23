# Paybound — Progress Log

Phase completions with test results. A phase is only "done" when its STOP-AND-TEST
block passes and is shown.

## Phase 0 — Foundations & scaffolding — IN PROGRESS

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

**Blocked on / pending before Phase 0 is DONE (Part G) — needs Owais:**
- [ ] Razorpay test keys + LLM API key → finish `.env`, run a Razorpay `fetch_payment`-equivalent call.
- [ ] Docker Desktop running → `docker compose up`, confirm `/health` 200 + trace visible in Grafana.
- [ ] Public GitHub repo URL → add remote, push, confirm CI green on first commit.
