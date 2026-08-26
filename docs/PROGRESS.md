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

## Phase 2 — Mandate & Consent Kernel + Reserve-Pay ledger — ✅ DONE

**Built:**
- `domain::mandate` — `Cart`/`CartLineItem` (with `recomputed_total` + `cart_hash`), `IntentMandate` (ed25519 `new_signed`/`verify_signature` over a canonical signing view), `CartMandate`, `PaymentMandate`.
- `reserve` crate — the SIMULATED Reserve-Pay fund-block: `ReserveBlock` with `new/from_parts/debit/release/revoke`, Single-Block-Multi-Debit, ceiling invariant enforced.
- `kernel` crate — pure `evaluate()` returning `Approved(Authorization) | Refused(RefusalReason)`; the 8-variant typed `RefusalReason` (+ `verdict()`/`as_str()`/`human_message()`); each bound as a named predicate (`check_ttl`, `check_cart_integrity`, `check_categories`, `check_merchant`).

**STOP-AND-TEST results:**
- [x] Pass **and** fail case for every `RefusalReason` — `cargo test -p kernel` → **11 passed** (happy path + all 8 reasons with adjacent passes + AFA boundary + verdict mapping).
- [x] Property test: any debit sequence can never breach the reserve ceiling — `cargo test -p reserve` → **5 passed**.
- [x] ₹15,001 → `RequiresHumanAFA`; ₹14,999 and exactly ₹15,000 → `Approved`.
- [x] Tampered mandate signature → `SignatureInvalid`.
- Kernel is pure (no I/O deps). Whole workspace: **33 tests pass**; offline `clippy -D warnings` + `fmt` clean.

## Phase 3 — MCP Storefront server — ✅ DONE

**Built:**
- `storefront-mcp` crate (lib + server bin): `Storefront` with the five tools — `search_catalog` (Postgres ILIKE ranking, trained-ranker swap point for Phase 7), `get_availability`, `get_variants`, `create_cart` (single-merchant, catalog-priced, persists a Cart Mandate), `checkout` (submits to the kernel, records gate_decision + audit entry, transitions session — **does NOT pay**).
- `src/mcp.rs`: MCP JSON-RPC (`initialize`/`tools/list`/`tools/call`). `src/discovery.rs`: agents.txt / ARD manifest / product feed / schema.org JSON-LD. `src/main.rs`: axum server.
- `ledger::repos` extended: `get_session`, `set_session_state`, `get_intent_mandate` (reconstruct + verifiable), `record_gate_decision`. Fixed `create_intent_mandate` to persist the signed `mandate_id`.
- `examples/seed_demo.rs` for HTTP/e2e exercising.

**STOP-AND-TEST results:**
- [x] All five tools callable by a client — HTTP MCP smoke (curl): initialize → tools/list (5 tools) → search_catalog → get_availability → get_variants → create_cart → checkout. Plus 4 integration tests (`cargo test -p storefront-mcp`).
- [x] `search_catalog` returns relevant products (category-first ranking over the 1000-item catalog).
- [x] `checkout` in-budget → **Approved** (HTTP smoke + integration test); over-cap → **typed refusal** `over_per_txn_cap` (integration test).
- [x] `agents.txt` served and valid; ard.json (5 tools, signed-mandate authority), feed.json (1000 products), schema.org JSON-LD all serve.
- Whole workspace: **37 tests pass**; offline `clippy -D warnings` + `fmt` clean.

## Phase 4 — Execution plane + Razorpay integration — ✅ DONE

**Built:**
- `razorpay-client`: typed REST client (`create_order`, `create_payment_link`, `fetch_payment_link`) behind a `PaymentGateway` trait; HMAC-SHA256 webhook verify/sign (raw-body, constant-time).
- `execution`: `ExecutionPlane` — `authorize` issues a scoped single-use delegated token, creates a REAL payment link, writes `payment_effect` + audit (TokenIssued/PaymentEffect), moves session to PAYING; idempotent via DB `ON CONFLICT` claim. `on_payment_paid` (→ COMPLETED, running_spend += amount, idempotent) and `on_payment_failed` (clean failure, NO hallucinated success).
- `gateway` (now lib+bin): `POST /webhooks/razorpay` — HMAC-verifies the raw body, dispatches paid/failed to the execution plane.
- Examples: `execution/examples/live_authorize` (real API).

**STOP-AND-TEST results:**
- [x] Real test-mode payment created via the execution plane — `live_authorize` produced real link `plink_TTKwPsyOhJE0Zy` (payable URL, visible in the Razorpay dashboard).
- [x] Duplicate call with same idempotency key does NOT double-charge — live (same link, `deduplicated=true`) + `duplicate_authorize_does_not_double_charge` (one link, one row).
- [x] `payment_link.paid` webhook HMAC-verified (raw body) closes the session — gateway test (signed → 200 + COMPLETED; bad signature → 401).
- [x] Failure branch clean — `failed_webhook_records_clean_failure_without_completing` (outcome=failed, session not completed). Live failure = pay a link with `failure@razorpay`.
- Note: live webhook delivery from Razorpay needs a tunnel + dashboard webhook secret (joint step); receiver proven via signed events.
- Whole workspace: **43 tests pass** (execution 4, razorpay-client 1, gateway 1 added); offline `clippy -D warnings` + `fmt` clean.

## Phase 5 — Walking skeleton (hard milestone) — ✅ DONE

**Built:**
- `crates/harness` (`walking-skeleton` bin): one command runs a hardcoded happy-path purchase through the ENTIRE spine — signed Intent Mandate → `create_cart` → `checkout` (kernel gate) → execution (REAL Razorpay payment link) → webhook receipt → session COMPLETED → renders + verifies the hash-chained audit trail.
- `scripts/walking_skeleton.sh` wrapper.
- Enhancement: `storefront.create_cart` now emits a `cart_built` audit event (complete chain).

**STOP-AND-TEST results:**
- [x] One command executes a full purchase end to end against real Razorpay test mode. Real payment links created (`plink_TTL4Jom1xpXiXG`, `plink_TTL4Yx6FoQ0fWy`).
- [x] Prints a complete, hash-verified audit chain: `session_created → cart_built → gate_decision → token_issued → payment_effect(pending) → payment_effect(success)`, each linked to the prior hash; **`verify_chain() = PASS`**.
- [x] Works reliably **twice in a row**.
- Whole workspace still **43 tests pass**; offline `clippy -D warnings` + `fmt` clean.

**MIDPOINT MILESTONE REACHED — the system is demoable end-to-end from here on.**

## Phase 6 — Buyer agent + agentic pipeline — ✅ DONE

**Built (services/agent/):**
- `precheck.py` (deterministic, pre-LLM: mandate validity, prompt-injection sanitisation, request budget), `base_agent.py` (bounded loop, request budget, checkout guardrail), `orchestrator.py` (owns the flow; ONLY checkout caller; DI of llm/mcp/db), workers: `discovery.py` (search + variants + rank, bounded to mandate), `cart_composer.py` (create_cart + confidence), `clarification.py` (asks on ambiguity).
- `llm.py` (Gemini, provider-agnostic, retry, call counter), `mcp_client.py` (HTTP MCP), `db.py` (psycopg read).
- Rust: `ExecutionPlane` → `Arc<dyn PaymentGateway>`; `Storefront::with_execution` (approved checkout → real payment link); kernel `afa_approved` resume; search → full-text; `merchant_id` in search view.
- `scripts/agent_demo.sh`, `services/agent/demo.py`, `crates/harness` seed bin.

**STOP-AND-TEST results:**
- [x] A natural-language goal drives a full purchase pre-check → orchestrator → workers → kernel → execution. LIVE: "buy running shoes under 3000" (real Gemini) → **AUTHORIZED** + real payment link.
- [x] Expired/missing mandate rejected by pre-check with **ZERO LLM calls** (asserted on the LLM call counter).
- [x] Ambiguous goal → Clarification worker → follow-up question. LIVE: "buy me something nice" → CLARIFY with a Gemini-written question.
- [x] >₹15,000 goal pauses at NEEDS_HUMAN and resumes on `approve()` (afa_approved) → AUTHORIZED.
- [x] Only the orchestrator calls checkout — runtime `UnauthorizedTool` guardrail + source-level structural test.
- **14 Python tests pass**; ruff clean. Rust: **44 tests**; clippy -D warnings + fmt clean.

## Phase 7 — Relevance / upsell / confidence ML — ✅ DONE

**Built (services/{relevance,upsell,confidence}/ + agent wiring):**
- `relevance/` — ESCI-trained XGBoost reranker (MiniLM + lexical); `train.py` reports NDCG before/after.
- `upsell/` — market-basket + complement model from Instacart + ESCI-C + Amazon Reviews 2023 (user co-review); category→complement table.
- `confidence/` — gradient-boosted Purchase Confidence Scorer on synthesised scenarios.
- Agent: Discovery reranks with relevance; Cart-Composer adds an upsell complement (same-merchant/in-budget/allowed) and scores confidence; below-threshold → NEEDS_HUMAN citing the scorer. Models loaded best-effort (`ml_loader.py`), optional so CI/tests run without artifacts.

**STOP-AND-TEST results:**
- [x] `search_catalog` outperforms keyword on held-out ESCI: **NDCG@10 0.9096 → 0.9202**.
- [x] `suggest_complements` returns sensible add-ons — LIVE: "buy running shoes under 3000" built a cart of **Trail Running Shoe ₹2850 + upsold Cushioned Ankle Socks ₹450** → AUTHORIZED.
- [x] `score_purchase` separates clear vs ambiguous (held-out ROC-AUC ~0.999, synthesised) and a below-threshold session routes to NEEDS_HUMAN **citing the scorer** (unit test).
- All three datasets used: Instacart (lift pairs), ESCI (relevance + 40k C pairs), Amazon Reviews 2023 (co-review, 582 keys).
- **Python 20 tests** (agent 15 + ml 3 + smoke 2), ruff clean. Rust **44 tests**, clippy/fmt clean.

## Phase 8 — Durable workflow spine — ✅ DONE

**Built (workflows/):**
- `purchase_workflow.py` — `PurchaseApprovalWorkflow`: durable approval wait + mandate-TTL timer; `approve` signal; returns AUTHORIZED (approved) or REVOKED (TTL).
- `activities.py` — `authorize_payment` (idempotent checkout w/ afa_approved), `expire_session`; `worker.py` (ThreadPoolExecutor for sync activities); `client.py` (start/approve/result).
- `scripts/durable_demo.sh` (crash-safety) + `crates/harness/src/bin/afa_seed.rs`.

**STOP-AND-TEST results:**
- [x] A session paused at NEEDS_HUMAN survives a full **worker kill + restart** and resumes on approval — LIVE demo: killed the worker mid-wait, restarted, approved → real payment link, `session_state=PAYING`.
- [x] A mandate that hits its TTL mid-session transitions cleanly to REVOKED (`test_mandate_ttl_expiry_revokes_the_session`, time-skipped).
- [x] **No operation double-executes across a crash** — exactly **1 payment_effect** after kill/restart/approve.
- Python **22 tests** (services 20 + workflows 2), ruff clean. Rust **44 tests**, clippy/fmt clean.

## Phase 9 — Explanation & audit narrative — ✅ DONE

**Built:**
- `services/explain/narrator.py` — `Narrator` writes a faithful one-sentence narrative into `audit_entry.narrative` for every entry (LLM describes, never decides).
- Gateway `GET /sessions/{id}/audit` — returns the narrated, hash-verified chain (pool added to `AppState`).
- `scripts/explain_demo.sh`; walking skeleton now prints `SESSION=` for scripting.

**STOP-AND-TEST results:**
- [x] Each purchase produces a readable narrative matching its actual decision — LIVE: narrated all 6 entries of a real purchase (session_created → cart_built → gate_decision → token_issued → payment_effect×2), each faithful ("The gate approved the transaction of ₹2,850", "A payment of ₹2,850 was successfully processed").
- [x] The read API returns the full narrated chain — `GET /audit` → `verified: True`, 6 entries with narratives.
- Narrator unit tests confirm it's fed the decision and instructs describe-only; audit-API integration test confirms narrated + verified + correct hash links.
- Rust **45 tests**, Python **24 tests**; ruff/clippy/fmt clean.

## Phase 10 — Observability, security & hardening — ✅ DONE (1 partial)

**Built:** money-path tracing spans (checkout/create_cart/authorize/razorpay) + W3C propagation (global propagator, agent injects `traceparent`, storefront extracts); `UNIQUE(delegated_token)` + `webhook_event` dedup table (migration 0002); dependency-free gateway rate limiter; heuristic LLM fallback.

**STOP-AND-TEST results:**
- [~] One purchase = single distributed trace — PARTIAL: all services export OTLP, the checkout money-path is one coherent Grafana trace (mcp → checkout → execution.authorize → razorpay), and `traceparent` is propagated agent→storefront (verified). The cross-language span *grouping* under one trace id is a known `tracing-opentelemetry` nuance (documented).
- [x] No secret present in the repo — `git grep` clean (only `.env.example` placeholders); `.env`/key files git-ignored; signing key ephemeral.
- [x] Duplicate/stale webhook rejected — `duplicate_webhook_is_deduped` (recorded + processed exactly once).
- [x] Scoped delegated token cannot be reused — `delegated_token_is_single_use` (UNIQUE violation on reuse).
- Rust **47 tests**, Python **24 tests**; clippy/fmt/ruff clean.

## Phase 11 — Evaluation harness & demo scenarios — ✅ DONE

**Built:** instant revocation (kernel `MandateRevoked` + `revoked_at` + gateway `POST /mandates/{id}/revoke`); the adversarial battery (`harness --bin adversarial` → `docs/BOUNDS_HOLD.md`); `scripts/revocation_demo.sh`; `eval/README.md`; `docs/HONEST_METRICS.md`.

**STOP-AND-TEST results:**
- [x] Adversarial battery passes — **10/10 bounds hold**, every violation blocked with the correct typed reason (signature, expiry, per-txn, cumulative, category, merchant, integrity/price-drift, AFA→needs_human, revocation). Table in `docs/BOUNDS_HOLD.md`.
- [x] Each demo scenario runs deterministically on demand — happy+upsell / graceful refusal (`agent_demo.sh`), live revocation (`revocation_demo.sh`, verified: buy→revoke→REFUSED mandate_revoked), >₹15k pause+crash-safe resume (`durable_demo.sh`).
- [x] Honest real-vs-simulated summary + bounds-hold table committed (`docs/HONEST_METRICS.md`, `docs/BOUNDS_HOLD.md`).
- Rust **48 tests** (kernel now 13 incl. revocation), Python **24 tests**; clippy/fmt/ruff clean.

---

## 🎉 ALL 12 PHASES (0–11) COMPLETE.
The full architecture is built end-to-end: the trust layer (signed mandates → pure kernel gate → simulated Reserve-Pay → hash-chained audit), the agentic pipeline (LangGraph-style orchestrator + workers + 3 trained models), real Razorpay test-mode payments, a durable crash-safe workflow, LLM-narrated audit trail, observability + hardening, and the adversarial "bounds hold" evidence.

## Frontend↔Backend integration (2026-08-27)

**Phase 0 (audit) — done.** `docs/INTEGRATION_MAP.md` written. Key finding: the frontend was a fully self-contained simulation (3 mock backends: express `server/routes/*` reimplementing the kernel in TS, Firestore as the store, inline `api.ts` fallbacks) making ZERO real-backend calls, with its own Firebase auth disconnected from the backend's bearer-token identity. Types/components were well-built and aligned, so the fix is a data-layer replacement, not a rebuild. Removed a byte-identical duplicate of the whole frontend that had been extracted at the repo root.

**Phase 1 (contract reconciliation) — done, STOP-AND-TEST passed.**
- New `frontend/src/lib/config.ts` (backend URLs), `token.ts` (Firebase login → stable backend bearer token bridge; user-bound token stored in Firestore, anonymous fallback in localStorage), rewrote `api.ts` to call the REAL backend (gateway :8080 + agent API :8092) with the bearer token, no Firestore-as-store, no simulation, no mock fallbacks — it throws on error so the UI shows honest errors. Added `CHOOSE`/`options`/`SessionView` to `types.ts`. `AuthContext` binds/clears the backend token on login/logout.
- Backend enrichment (pulled-forward BUILD-BACKEND): `OrchestratorResult` now carries `amount_paise` + a display `cart` (real catalog titles/prices, sourced from the composer — the signed `CartLineItem` envelope stays minimal). Exposed in the agent API result.
- Verified live: POST /identity, GET /catalog/categories (bare string[]), POST/GET /mandates, GET /sessions/{id}, GET /sessions/{id}/audit, POST /sessions/{id}/run (CHOOSE + options), /select (NEEDS_HUMAN with real ₹56,669 ring cart + amount) — every shape matches `api.ts`/`types.ts`. Python suite 28/28. Frontend `tsc --noEmit` clean. (No Rust changed this phase.)

**Phase 2 (core three pages, live) — done, STOP-AND-TEST passed.**
- Rewrote `ShopPage` (removed `INITIAL_CARTS` seeds + the setTimeout pipeline animation; real run/select/approve; the stepper now reflects the real terminal state; honest decline = a local flag, no invented verdict; honest error banner on backend failure), added a `ChoicePicker` for the CHOOSE state. Rebuilt `AuditPage` from a fabricated admin-log table (fake IPs/devices/PII) into the real hash-chain viewer using the existing `AuditTimeline`/`VerifyBadge`. Fixed `MandateForm` (bogus `merchant_id:"mer_demo_razorpay_store"` → `null` so the backend uses its real default merchant; default categories → empty = all). Cleaned fabrication from `CartDetailView`/`OutcomeCard` (no fake amounts/titles/payment-links/LLM-counts; `?? N` guards → real values or "—").
- Fixed two real bugs in the token bridge found via live browser testing: (1) `clearToken()` was firing on the anonymous auth state (every load pre-login), wiping the just-minted token and orphaning mandates → 403s; now only on explicit logout. (2) concurrent first-load `authFetch` calls each minted their own identity → replaced with a module-singleton token promise (one mint per browser, race-safe, re-reads storage to converge). Moved the frontend dev port 3000→5173 (3000 collides with Grafana).
- Verified end-to-end through the REAL UI against the REAL backend: create mandate (real signed, real UUID) → 115 real categories → run "buy running shoes" → CHOOSE with 5 real options → ChoicePicker → select → kernel APPROVED → real Razorpay call → honest 429 (the known, external payment-link quota; surfaced as an error, never faked) → AuditPage shows the real 3-entry hash chain + verify badge. No `Math.random`, no mock imports, no dead `/api/*` fetches remain in the shipped path. Frontend `tsc` clean.

**Phase 3 (extra representational panels) — done, STOP-AND-TEST passed.**
Landing page + shell chrome audited for fabricated data:
- `LandingInteractiveConsole` → **HONEST-EMPTY**: labeled "ILLUSTRATIVE — NOT LIVE DATA", removed live-implying language ("DETERMINISTIC KERNEL ACTIVE" ping, "in real-time"), fixed fabricated metrics (`latency_ms:0.8`→`llm_calls:0`, "0ms Gating"→"LLM-Free Gating", "plink_..._live_..."→"plink_example", "< 1ms"→"deterministically"), footer links to the real /shop console.
- `LandingKernelSection` "0.8ms KERNEL" → "LLM-FREE KERNEL"; `LandingAuditSection` "verifies ... in 0.8ms" → "deterministically, with no LLM in the loop" (fabricated latency we never measured → truthful qualitative claim).
- `AppShell` footer "Firestore Authenticated" → "Razorpay Test Mode" (Firebase is login-only now); nav Audit link's hardcoded fake fallback session `ses_377a1359…` → `/audit` (AuditPage resolves the real session).
- KEEP (legitimate): LandingHero design claims, other marketing sections, LoginPage (clean). Dead now (unused, not in shipped path; to delete in Phase 5): `AuditMasterTable`, `AuditLogDetail`, `mockData.ts`.
- Verified in the browser: illustrative label present, no "0.8ms"/"in real-time" anywhere, honest footer. `tsc` clean. Sweep for hashes/ids/latency literals accounted for — only remaining fabricated-looking ids live inside the clearly-labeled illustrative console.

**Phase 4 (new backend endpoints + strip mock) — done, STOP-AND-TEST passed.**
- **Real SSE pipeline stream** (the BUILD-BACKEND the user chose over honest-final-state): instrumented the orchestrator with an `on_stage(stage_id, status)` callback threaded through run/select/_compose_and_checkout/_checkout (defaults to a no-op, so /run and the tests are untouched). Added `POST /sessions/{id}/run/stream` and `/select/stream` on the agent API — they run the blocking orchestrator in a threadpool and bridge genuine stage events + the terminal OrchestratorResult over `text/event-stream` via an asyncio queue. Frontend consumes it with fetch + ReadableStream (not EventSource, so the bearer token + POST body work): `runAgentStream`/`selectOptionStream` in api.ts forward each event to the ShopPage stepper live.
- Verified LIVE in the browser: the stepper nodes light up one-by-one on real backend events — run shows pre_checks→parsing→searching; select shows composing→kernel_gate — then the terminal result (CHOOSE stepper correctly `done,done,done,idle,idle,idle`; the Razorpay 429 arrives as an honest SSE error event, surfaced as an error banner, never faked).
- **Stripped the dead express mock backend**: deleted `frontend/server/routes/*` (the TS reimplementation of the kernel), reduced `server.ts` to a pure vite/static host (no `/api/*` at all), deleted the now-dead `mockData.ts`, `AuditMasterTable.tsx`, `AuditLogDetail.tsx`. There is no longer any mock backend for the frontend to fall back to.
- Full Python suite 28/28, ruff clean, frontend tsc clean. (No Rust changed this phase.)

**Phase 5 (regression + demo rehearsal) — done, STOP-AND-TEST passed. INTEGRATION COMPLETE.**
- Cold-started backend (`run_backend.sh`) + frontend fresh, no prior session state. Ran the 4 demo scenarios **twice back-to-back — 4/4 both times**: happy-path (kernel APPROVES; the real Razorpay call returns the known external 429 quota, surfaced honestly — completes with a real link once a fresh key is set), over-cap → REFUSED/over_per_txn_cap, >₹15k → NEEDS_HUMAN/requires_human_afa, live revocation → REFUSED/mandate_revoked. Plus a cold browser smoke (create mandate → run → CHOOSE with 5 real options, no error).
- Final anti-fabrication sweep of the shipped path — all clean: no `Math.random`, no mock/fixture imports, no `/api/*` fetches, no express mock routes, no fabricated ids outside the clearly-labeled illustrative landing console.

**Before/after tally (per INTEGRATION_MAP row):**
- **WIRE** (endpoint existed + matched): llm-call counter, trace badge, live spend meter — now fed by the real `OrchestratorResult`/`GET /sessions/{id}`.
- **ADAPT** (rewired to the real contract): getCategories, listMandates, createMandate, revokeMandate, getSession, getAuditChain, runAgent, approveSession, the Firebase→backend-token auth bridge, MandateForm (bogus merchant_id→null). Direction per Part D rule 6: frontend changed to match the backend's tested contract in every case.
- **BUILD-FRONTEND**: the CHOOSE `ChoicePicker`; the AuditPage rebuilt onto the real `AuditTimeline`/`VerifyBadge`.
- **BUILD-BACKEND**: `OrchestratorResult` enrichment (`amount_paise` + display `cart`); the real SSE progress endpoints `/sessions/{id}/run/stream` + `/select/stream` (orchestrator `on_stage` instrumentation).
- **CUT**: `INITIAL_CARTS`, `INITIAL_AUDIT_LOGS`, `mockData.ts`, `AuditMasterTable`, `AuditLogDetail`, and the entire `server/routes/*` express mock (TS kernel reimplementation) — nothing to fall back to fabricated data anymore.
- **HONEST-EMPTY**: `LandingInteractiveConsole` labeled "ILLUSTRATIVE — NOT LIVE DATA"; fabricated "0.8ms" latency claims (3 places) → truthful "LLM-free / deterministic" wording; footer "Firestore Authenticated" → "Razorpay Test Mode"; nav's fake fallback session id removed.

**Net:** the frontend now runs entirely on the real Rust/Python backend with real bearer-token identity; every on-screen number/hash/id/status traces to a real backend response or an honestly-labeled illustration. The only path that cannot fully complete is the final Razorpay payment-link creation (external test-mode quota exhausted) — and it fails honestly as an error, not a faked success.
