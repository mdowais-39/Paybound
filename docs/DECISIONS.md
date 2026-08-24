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

## Phase 2 — Mandate & Consent Kernel (crown jewel)

- **Kernel is pure, zero-I/O.** The `kernel` crate has no sqlx/tokio/network deps at all — `evaluate(cart, mandate, running_spend, now)` takes only data and returns `Approved(Authorization) | Refused(RefusalReason)`. The Reserve-Pay ledger read happens outside and `running_spend` is passed in, keeping the gate exhaustively testable (Part F #1).
- **`RequiresHumanAFA` is a `RefusalReason` whose `verdict()` maps to `needs_human`.** This keeps the prompt's exact 8-variant enum while producing the correct DB verdict: the ₹15,000 AFA case routes to human approval, all other reasons are hard `refused`.
- **Deterministic check order:** signature → TTL → cart integrity → category → merchant → per-txn cap → cumulative budget → AFA. The cited reason is always the most fundamental failure, which makes the refusal explainable.
- **Empty allow-list = unrestricted on that axis** (documented, not a loophole): an empty `allowed_categories`/`allowed_merchants` imposes no filter, but the amount caps and TTL still bind every purchase.
- **Cart integrity = recomputed-total match + optional expected-hash.** The kernel re-derives the total from line items (rejects a lying `total_paise`) and, when an `expected_cart_hash` is supplied, requires the cart hash to match exactly (the price-drift / item-substitution scenario for Phase 11).
- **ed25519 types re-exported from `common`** (`Ed25519SigningKey`/`VerifyingKey`) so `domain` names the crypto types through `common` rather than taking a second direct dalek dependency.

## Phase 3 — MCP Storefront server

- **MCP surface = axum JSON-RPC 2.0 over HTTP POST** (`initialize`/`tools/list`/`tools/call`), not the Rust MCP SDK. A single POST endpoint returning `application/json` is valid MCP Streamable-HTTP for non-streaming tool calls, is trivially testable with curl, and keeps the tool *semantics* in `Storefront` (SDK-swappable seam). Chosen per the prompt's Phase 3 risk note to avoid sinking time in an immature SDK.
- **`checkout` is the architectural heart: it never pays.** It reconstructs the exact cart from the persisted Cart Mandate, calls `kernel::evaluate`, writes a `gate_decision` + hash-chained audit entry, transitions the session (AUTHORIZED/NEEDS_HUMAN/REFUSED), and returns the decision. The agent has no tool that moves money.
- **Real bug caught by integration test (mandate_id).** `create_intent_mandate` originally let Postgres generate a fresh `mandate_id`, but the ed25519 signature is over the *signed* `mandate_id`; on reconstruction the ids differed and every signature failed → spurious `SignatureInvalid` refusals. Fixed by persisting the given `mandate_id` (it is part of the signed envelope). Exactly the seam bug the "integrate early" discipline exists to surface.
- **`create_cart` prices come from the catalog, never the agent.** The agent passes item ids + quantities; the storefront looks up price/category/merchant from the DB and enforces single-merchant carts.
- **Discovery surface:** `/.well-known/agents.txt` (robots-style pointer), `/.well-known/ard.json` (ARD manifest declaring tools + the signed-Intent-Mandate authority required), `/feed.json` (OpenAI/Google-style feed, prices in minor units), `/schema/{id}` (schema.org Product/Offer JSON-LD).
- **`examples/seed_demo.rs`** creates a signed mandate + bound session against the real catalog — reused for the HTTP smoke test now and the Phase 5 walking skeleton.

## Phase 4 — Execution plane + Razorpay

- **Payment path = Payment Links.** Probed the account: S2S UPI create (`/payments/create/upi`) returns 404 (not enabled), so an automated PIN-less UPI charge isn't available. Payment Links ARE real, dashboard-visible, payable objects — so execution creates a real link and completion is driven by the real `payment_link.paid` webhook (live) or a correctly-HMAC-signed synthetic event (automated tests). Stated openly.
- **Idempotency via DB-first claim, not Redis-only.** `authorize` does `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING` to atomically claim the key *before* creating the link — so a retry never creates a second link or double-charges, and there are no orphan links from a lost race. This is stronger than the prompt's Redis-only design; a Redis read-through cache is deferred to Phase 10. Verified live (same link on retry, `deduplicated=true`) and in tests.
- **`PaymentGateway` trait** decouples execution from the network: real `RazorpayClient` impl for production, a fake for deterministic tests (idempotency, paid/failed handling).
- **Webhook HMAC verified against the RAW body** (axum `Bytes` extractor, never re-serialized), constant-time compare via HMAC `verify_slice`. Bad signature → 401.
- **Gateway refactored to lib+bin** so the webhook receiver is testable via `tower::oneshot`.
- **Delegated token** = random 32-byte hex, scoped to one `payment_effect` (single-use); reuse is blocked by idempotency. This is the Shared-Payment-Token pattern (our own token, not a Razorpay recurring token).
- **No Razorpay `revoke_token`/AutoPay.** AutoPay recurring needs account enablement + a mandate-approval flow. Our revocation is at our own layer (Intent Mandate + Reserve-Pay ledger), which is where "kill the authority" actually lives in this architecture.
- **Live webhook delivery is a joint step:** to have the REAL `payment_link.paid` webhook reach the local gateway, a tunnel (cloudflared/ngrok) + a dashboard webhook with `RAZORPAY_WEBHOOK_SECRET` must be configured. The receiver logic itself is fully proven with signed synthetic events.

## Phase 5 — Walking skeleton (milestone)

- **Dedicated `harness` bin crate** (`walking-skeleton`) wires the real storefront + execution + ledger into one command. It's also the natural home for the Phase 11 scenario runner.
- **Only the agent and the webhook receipt are stood in.** The webhook receipt is `exec.on_payment_paid(razorpay_ref)` — the exact code the HMAC-verified webhook handler runs — so nothing on the money path is mocked. The payment link is a REAL test-mode object; in the live venue the real `payment_link.paid` webhook fires instead.
- **Added a `cart_built` audit event to `storefront.create_cart`** so the end-to-end chain is complete: `session_created → cart_built → gate_decision → token_issued → payment_effect(pending) → payment_effect(success)`. `session_created` is appended by the caller at delegation (the agent takes this over in Phase 6).
- **Reliability:** runs cleanly twice in a row (fresh session + real link each run; `verify_chain` PASS both times).

## Phase 6 — Buyer agent + agentic pipeline (Python)

- **Gemini API key format:** the key is an AI Studio API key used via `?key=` (NOT an OAuth Bearer token). Model `gemini-flash-latest` (a stable alias; `gemini-2.0-flash` is retired). Added a retry (429/500/503) for transient API errors.
- **checkout triggers execution server-side.** Refactored `ExecutionPlane` to hold `Arc<dyn PaymentGateway>` (was generic) so it embeds in the storefront; `Storefront::with_execution` makes an approved `checkout` create the real payment link. The agent therefore has NO money tool — `checkout` is its only spending path, fully kernel-gated (the ACP merchant→PSP pattern). Gate-only `Storefront::new` is kept for the Phase 3 tests and the walking skeleton.
- **AFA human-approval resume:** added `afa_approved` to the kernel input + `checkout`; the orchestrator's `approve()` re-runs checkout with it true to clear the ₹15,000 gate (all other bounds still enforced).
- **Bounded shopper:** the Discovery worker filters search results to the mandate's allowed category + merchant *before* proposing — so the agent shops only buyable items (the kernel remains the gate). Required adding `merchant_id` to the catalog search view.
- **Search upgraded to Postgres full-text** (`plainto_tsquery` + `ts_rank`, ILIKE fallback) so "running shoes" matches "Running Shoe" (stemming). The Phase 7 trained ranker swaps in behind the same tool.
- **Dependency-injected orchestrator** (llm/mcp/db) so the safety properties are unit-testable with fakes — no live LLM/server/DB needed in CI: zero-LLM-before-precheck, ambiguous→clarify, needs-human pause+resume, and "workers cannot call checkout" (runtime guardrail + source-level structural test).

## Phase 7 — Relevance / upsell / confidence ML

- **Relevance ranker (Amazon ESCI):** XGBoost over [MiniLM semantic cosine + lexical overlap + length] features, trained on ESCI-US graded labels (E/S/C/I → 3/2/1/0). Held-out **NDCG@10 0.9096 → 0.9202 (+1.2%)** over a keyword baseline — a real gain on an already-strong baseline (ESCI queries/titles share vocabulary). Reranks the storefront's candidate results inside the Discovery worker.
- **Upsell (all three sources):** Instacart Market-Basket → product/aisle 'bought-together' via lift (classic pairs: bananas+strawberries ×2384); Amazon **ESCI-C** → 40,049 explicit complement pairs; **Amazon Reviews 2023** → user **co-review** category complements on Clothing/Shoes/Jewelry (1402 categories, 582 complement keys). Combined into a category→complement-category table the Cart-Composer applies over the live catalog (same-merchant, in-budget, mandate-allowed category).
- **Amazon Reviews 2023 honesty:** the 2023 release DROPPED the `also_bought`/`bought_together` co-purchase fields (they existed in 2018), and the Amazon_Fashion meta has no sub-taxonomy — so those yielded nothing. We instead derive complements from real **user co-review** on the Clothing/Shoes/Jewelry split (which has a sub-category taxonomy). Documented; the HF loading script is also deprecated, so we stream McAuley's direct jsonl.gz.
- **Purchase Confidence Scorer:** gradient-boosted classifier over 5 named features (cart-to-goal match, price variance, category ambiguity, clarification turns, upsell acceptance), trained on **synthesised** clear/ambiguous scenarios (stated openly). Replaces the heuristic 'low confidence' with a deterministic, inspectable signal; below threshold routes to NEEDS_HUMAN **citing the scorer**, same footing as the ₹15,000 AFA rule.
- **Serving = in-process** (the plan explicitly allows this over a network hop): the agent loads the three joblib artifacts best-effort at startup; if any is missing it falls back to heuristics (so CI, which does not train, and all unit tests stay green). Model artifacts (`*.joblib`) and datasets (`data/raw/`) are git-ignored and reproduced by the `train.py` scripts.
- **CPU PyTorch** (not CUDA): the sampled ESCI subset + small GBMs train in minutes; the GPU would only speed embedding, which isn't the bottleneck at this scale.

## Phase 8 — Durable workflow spine

- **Temporal (Python SDK) drives the durable workflow; Rust services are activities** invoked over HTTP (the MCP checkout). Chosen over Restate because Temporal's Python SDK is GA while the Rust SDK is public-preview (the prompt's recommended split).
- **The NEEDS_HUMAN wait and the mandate-TTL are both durable:** `workflow.wait_condition(lambda: approved, timeout=ttl)` — the approval signal resumes it, the TTL timeout revokes it. State lives in the Temporal server, so killing + restarting the worker mid-wait resumes exactly where it left off.
- **No double-execution across a crash:** the `authorize_payment` activity goes through the idempotent execution plane (`ON CONFLICT`), so a retry after a crash returns the same payment link. Verified: after kill → restart → approve, the session has exactly **1 payment_effect**.
- **TTL expiry → session REVOKED** (the authority ended before approval).
- **Sync activities run via a `ThreadPoolExecutor`:** the activities use `requests`/`psycopg` (blocking), and Temporal requires an `activity_executor` for non-async activities (caught at runtime — the async test mocks had hidden it).
- **Temporal behind the compose `workflow` profile** (opt-in); its `auto-setup` image creates the temporal databases in the app Postgres.
- **Tests use `WorkflowEnvironment` time-skipping with mocked activities** (deterministic, no external Temporal/storefront/DB); they skip if the test server can't start, so CI stays green.
