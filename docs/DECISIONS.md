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
