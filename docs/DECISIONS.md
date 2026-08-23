# Paybound — Decision Log

Every deviation from the master build prompt, and every non-obvious engineering
choice, with a one-line reason. Newest at the bottom of each phase.

## Phase 0 — Foundations

- **Project name `paybound` accepted** as-is — payment + bounded; clean repo slug; echoes "bounded autonomy."
- **Repo location:** `Razorpay/paybound/` (nested under the planning folder) so the source docs sit alongside the build. Copies of the key planning docs live in `docs/`.
- **GPU present (RTX 4060, 8 GB):** Phase 7 relevance/confidence models will use the CUDA PyTorch build for faster iteration. Everything is required to work correctly on CPU too — GPU is a nice-to-have, not a dependency.
- **conda not on shell PATH:** installed at `~/miniconda3`; invoked by full path / `conda run -n paybound`. Env `paybound` (Python 3.11) created. Not a blocker.
- **Money = `BIGINT` paise everywhere** (Part F #4). Dropped `rust_decimal` from the stack; no floats or decimals on the money path.
- **Telemetry:** OTLP gRPC → OTel Collector → Tempo → Grafana. `telemetry::init` returns a guard that flushes on drop, and **degrades to logs-only** (does not crash) if the collector is unreachable — a service must still boot when observability infra is down. OpenTelemetry Rust 0.27 line (sdk/otlp 0.27, tracing-opentelemetry 0.28).
- **Temporal behind a compose `workflow` profile:** not needed until Phase 8, so Phase 0's `docker compose up` stays light (Postgres, Redis, Collector, Tempo, Grafana only).
- **`SQLX_OFFLINE=true` in CI** from the start; the `.sqlx` query cache is generated and committed in Phase 1 so CI needs no live DB.
- **Catalog dataset: Amazon Berkeley Objects** (public AWS Open Data, no login) as the storefront spine — unblocks Phase 1 immediately. Flipkart (₹-priced, needs Kaggle) may be added later for demo optics.
- **storefront-mcp:** will attempt the Rust MCP SDK in Phase 3; if it proves immature, fall back to a thin `axum` JSON-RPC surface speaking MCP's wire format (per the prompt's Phase 3 risk note).
- **LLM provider: Google Gemini** (Owais has a Google AI Pro subscription → higher free API limits via AI Studio). Agent Orchestrator + Explanation service will target a `gemini-flash` model (fast, strong tool-calling). Integration kept **provider-agnostic** (single LLM-client abstraction keyed on `LLM_PROVIDER`) so we can swap to Anthropic Claude for the final demo recording (thematic fit with Razorpay's NPCI+Anthropic pilot) if a little credit is added. Not needed until Phase 6.
- **Telemetry gotcha found & fixed (Phase 0):** `tower-http`'s `TraceLayer` emits its request span at DEBUG level, which the default env-filter (`info,paybound=debug`) drops for non-`paybound` targets — so no span reached the collector. Fixed by instrumenting request handlers at INFO (`#[tracing::instrument(level = "info")]`) so exported traces don't depend on tower-http's span level. Verified end-to-end: gateway → OTLP → collector → Tempo (trace queryable, `rootServiceName=paybound-gateway`).

## Phase 1 — Data layer & audit ledger

- **Postgres port clash → host 5433.** A local `postgresql-x64-17` Windows service already owns 5432, so host→`localhost:5432` hit that instance (no `paybound` user) and auth-failed. Remapped the container to publish host **5433** (`5433:5432`); container-internal 5432 unchanged, so Temporal's internal link is unaffected. `DATABASE_URL` and defaults updated to 5433.
- **pgvector image collation quirk.** `pgvector/pgvector:pg16`'s `template1` reports a glibc collation-version mismatch, which blocks `CREATE DATABASE` (used by `#[sqlx::test]` per-test DBs). Fixed with a one-time `ALTER DATABASE template1 REFRESH COLLATION VERSION;` locally, and a best-effort CI step (`|| true`, no-op when versions already match on the Linux runner).
- **Compile-time-checked SQL + offline cache.** All ledger queries use `sqlx::query!`/`query_scalar!` (malformed SQL fails at build). The `.sqlx` offline cache is committed and regenerated with `cargo sqlx prepare --workspace -- --all-targets` (the `--all-targets` is required to capture `query!` macros inside test files). CI builds with `SQLX_OFFLINE=true` (no DB needed to compile) and runs the integration tests against a Postgres **service** container.
- **Audit timestamp folded as unix-microseconds (i64), not RFC3339.** Postgres `timestamptz` truncates to microseconds; hashing an integer derived from `unix_nanos/1000` round-trips exactly on read, whereas a formatted string could drift on the nanos→micros boundary and break `verify_chain` on a legitimate chain.
- **ABO catalog prices are SYNTHESIZED (honesty note).** Amazon Berkeley Objects has real titles/categories/brands/colours/variants but **no price**. Prices are generated per category from plausible ₹ ranges, deterministically seeded per `item_id` so re-runs are stable. Stated in the ingestion script header and here. 1000 items ingested across 144 categories (₹439–₹14,356). The first shard skews toward one category family (phone cases); may balance the sample across shards in Phase 3 when search relevance matters.
