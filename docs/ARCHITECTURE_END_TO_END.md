# Paybound — End-to-End Architecture & Product Guide

*The complete picture: every backend service, what it does, how it works, how the
pieces connect, the full purchase workflow, and the novelty story for judges.*

Track 1 — AI Growth & Agentic Commerce · Razorpay AI Buildathon.

---

## 0. The product in one paragraph

**Paybound is the trust-and-authorization layer that lets a merchant accept an AI
buyer safely on Razorpay's rails.** An external AI agent takes a natural-language
goal ("buy running shoes under ₹3,000"), discovers a real catalog, builds a cart,
and pays — but every rupee it moves passes through a deterministic, cryptographically
signed **mandate gate** that enforces hard limits (amount, category, merchant,
time) *before* money can move, produces a tamper-evident **audit chain** explaining
why every action happened, and can be **revoked instantly** by the human. When a
limit is hit, the agent refuses gracefully — it never crashes or hallucinates a
success. The shopping is the demo; the trust layer is the product.

The problem statement has eight requirements. **Five of them — explainable,
bounded, gated, audit trail, graceful failure — are about safety, not shopping.**
Paybound's architecture is built so that every trust-critical guarantee lives in a
small, pure, exhaustively-tested core, and everything else (the LLM, the ML models,
the UI) is a replaceable layer that hands off to that core. The reliability comes
specifically from *not* duplicating anything trust-critical.

---

## 1. The stack at a glance

| Layer | Technology | Why |
|---|---|---|
| **Trust core + money path** | Rust (10-crate Cargo workspace) | Deterministic, memory-safe, compile-time-checked SQL; the gate must never be wrong. |
| **Agentic pipeline + ML/LLM** | Python 3.11 (FastAPI, LangGraph-style orchestrator) | Fast iteration for the AI layer; where the ecosystem's ML/LLM libraries live. |
| **Durable workflow** | Temporal (Python SDK) | Human-approval pauses survive a crash without double-charging. |
| **Frontend** | React + Vite + TypeScript + Tailwind | The console: shop, mandates, live audit trail. |
| **Data** | PostgreSQL 16 + pgvector | One relational store; vector column for semantic search. |
| **Payments** | Razorpay test-mode REST (Payment Links, Orders) | Real `plink_*` objects, real webhooks, dashboard-visible. |
| **Observability** | OpenTelemetry → OTel Collector → Tempo → Grafana | Distributed money-path tracing. |
| **Identity/crypto** | ed25519 (dalek), SHA-256 | Signed mandates + hash-chained audit ledger. |

**Scale of the build:** 10 Rust crates, 7 Python services, 8 SQL migrations, a
1,000-product real catalog across 144 categories, 3 trained ML models, **34 Rust
tests + 60 Python tests**, and 4 scripted end-to-end demo scenarios.

### The three running servers (+ their ports)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Frontend (React/Vite)  :5173                                            │
│      │ bearer-token identity                                             │
│      ▼                                                                   │
│  ┌───────────────────┐        ┌───────────────────────┐                 │
│  │  Agent API        │  MCP   │  storefront-mcp       │                 │
│  │  (Python/FastAPI) │──JSON─▶│  (Rust)               │                 │
│  │  :8092            │  RPC   │  :8081                │                 │
│  │                   │        │  catalog + kernel     │                 │
│  │  orchestrator,    │        │  gate + execution     │                 │
│  │  workers, ML, LLM │        └───────────┬───────────┘                 │
│  └─────────┬─────────┘                    │                             │
│            │                              │                             │
│            │ reads mandate/session        │ writes gate/payment/audit   │
│            ▼                              ▼                             │
│  ┌──────────────────────── PostgreSQL :5433 ──────────────────────────┐ │
│  └────────────────────────────────────────────────────────────────────┘ │
│            ▲                              ▲                             │
│  ┌─────────┴─────────┐        ┌───────────┴───────────┐                 │
│  │  Gateway (Rust)   │        │  Razorpay test-mode   │                 │
│  │  :8080            │◀─webhook│  REST API (external) │                 │
│  │  mandates, audit, │        └───────────────────────┘                 │
│  │  revoke, identity │                                                  │
│  └───────────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

**Why three servers, not one:** the split is deliberate and maps to trust
boundaries.
- **storefront-mcp (Rust, :8081)** owns the catalog *and* the kernel gate *and* the
  execution plane — everything trust-critical about a purchase. It's the merchant's
  agent-facing surface (the MCP tools) and the only thing that touches the money
  path.
- **gateway (Rust, :8080)** owns mandate lifecycle (create/list/revoke), identity,
  the audit-read API, and the Razorpay webhook receiver — the human-facing control
  plane and the payment-confirmation ingress.
- **agent-api (Python, :8092)** owns the *reasoning* — the orchestrator, workers,
  LLM, and ML models. It has no money tool; it can only call the storefront's MCP
  tools, exactly like any external agent would. This is the ACP pattern: **the agent
  never gets a money tool.**

---

## 2. The Rust trust core (10 crates)

The workspace is layered so the crown jewel — the kernel — is a pure function with
zero I/O, and everything stateful sits outside it.

### 2.1 `common` — cross-cutting primitives
Config (figment), telemetry (OTLP→Tempo, degrades to logs-only if the collector is
down), **canonical JSON** (sorted-key serialization so a hash/signature is stable),
and **ed25519 signing/verify** over canonical bytes. Every signature and every hash
in the system derives from `common`'s canonical encoding, so they round-trip
exactly. **6 tests** (key-order invariance, sign/verify roundtrip, tamper rejection).

### 2.2 `domain` — the shared vocabulary
The typed model everything else speaks: `SessionState`, `Verdict`
(`approved`/`refused`/`needs_human`), `AuditEventType`, the `Paise` money type, and
`AFA_THRESHOLD_PAISE` (₹15,000 = 1,500,000). Also the **mandate chain types**:
`IntentMandate` (with `new_signed`/`verify_signature`), `CartMandate`,
`PaymentMandate`, and `Cart`/`CartLineItem` (with `recomputed_total` + `cart_hash`).
Money is `BIGINT` paise everywhere — no floats, no decimals on the money path.

### 2.3 `kernel` — the Mandate & Consent Kernel (the crown jewel)
A **pure, zero-I/O function**: `evaluate(&KernelInput) -> KernelDecision`. It takes
only data — the proposed cart, the active mandate, the running spend, and `now` —
and returns `Approved(Authorization)` or `Refused(RefusalReason)`. It has no sqlx,
no tokio, no network dependency at all. The Reserve-Pay ledger read happens *outside*
and `running_spend` is passed *in*, which keeps the gate exhaustively testable.

The **9 typed refusal reasons** (checked in this deterministic order, so the cited
reason is always the most fundamental failure):

1. `SignatureInvalid` — the Intent Mandate's ed25519 signature doesn't verify.
2. `MandateExpired` — past its TTL.
3. `CartIntegrityMismatch` — recomputed total ≠ claimed total, or cart hash ≠
   expected (price drift / item substitution).
4. `CategoryNotAllowed` — a line item's category is outside the allow-list.
5. `MerchantNotAllowed` — the cart's merchant is outside the allow-list.
6. `OverPerTxnCap` — cart total exceeds the per-transaction ceiling.
7. `OverCumulativeBudget` — running spend + this cart would breach the total budget.
8. `RequiresHumanAFA` — within the mandate but above ₹15,000 → needs human PIN-equiv.
9. `MandateRevoked` — the human revoked authority; nothing more can be spent.

**Empty allow-list = unrestricted on that axis** (documented convention, same as the
prompt), but the amount caps and TTL still bind every purchase. `RequiresHumanAFA`
maps to the `needs_human` verdict; every other reason is a hard `refused`. **13
tests** — a pass *and* a fail case for every reason, plus the AFA boundary
(₹14,999 and exactly ₹15,000 approve; ₹15,001 needs human).

**Why this is the crown jewel:** it's deterministic and it removes over-limit
actions from the choice set *before* the agent can act — the agent is structurally
incapable of overspending. In a payments company deciding whether to trust agent
autonomy, this gate is worth more than the cleverness of the shopping agent.

### 2.4 `reserve` — the simulated Reserve-Pay ledger
Razorpay's UPI Reserve Pay (Single-Block-Multi-Debit) has **no public self-serve
API** — it powers the closed Claude pilot. So we implement it, in the open, as a
ledger primitive: `ReserveBlock` with `new`/`debit`/`release`/`revoke`, enforcing a
ceiling invariant that no sequence of debits can ever breach. **5 tests** including a
property test: any debit sequence, in any order, can never exceed the block ceiling.

### 2.5 `ledger` — the data layer + hash-chained audit
Compile-time-checked sqlx repos (malformed SQL fails the build; `.sqlx` offline cache
committed for CI). Owns the **hash-chained audit ledger**: `append`, `list_chain`,
`verify_chain`. Each entry carries the SHA-256 of the previous entry's canonical
payload, so the chain is tamper-evident — altering any past entry breaks
`verify_chain`. Timestamps are folded as unix-microseconds (i64) so they round-trip
exactly and never drift the hash. **5 tests** (2 pure hash + 3 integration:
verify passes, tampering a payload fails, rewriting a stored hash fails).

### 2.6 `storefront-mcp` — the agent-readable merchant (the buyer's whole world)
The merchant's agent-facing server (:8081). Two surfaces:

**The interactive MCP layer** (`/mcp`, JSON-RPC 2.0 — `initialize`/`tools/list`/
`tools/call`) exposes the five tools an agent needs to shop:
- `search_catalog` — full-text + pgvector semantic ranking over 1,000 real products.
- `get_availability` — live price/stock for an item.
- `get_variants` — resolve size/colour variants.
- `create_cart` — single-merchant, catalog-priced; persists a **Cart Mandate** and
  emits a `cart_built` audit event.
- `checkout` — submits the cart to the **kernel** (gate_decision + audit entry +
  state transition). **It does NOT pay** — approval just authorizes; the execution
  plane creates the real payment link.

**The discovery layer** (the three catalog-standard representations, so the merchant
is shoppable however an agent finds it): `/.well-known/agents.txt` and
`/.well-known/ard.json` (Agentic Resource Discovery manifest declaring the authority
an agent needs), `/feed.json` (product feed), and `/schema/{item_id}` (schema.org
Product/Offer JSON-LD).

This is the **build differentiator** the knowledge doc names: not just a static feed,
but a live, tool-driven, kernel-gated storefront.

### 2.7 `razorpay-client` — the real payment rail
Typed REST client behind a `PaymentGateway` trait: `create_order`,
`create_payment_link`, `fetch_payment_link`, plus **HMAC-SHA256 webhook verify/sign**
over the raw body, constant-time. A `DryRunGateway` swaps in for load-free testing
(exercises the full `authorize()` logic without hitting Razorpay's quota).

### 2.8 `execution` — the execution plane (ACP shared-token pattern)
`ExecutionPlane::authorize()` runs *after* the kernel approves. It:
1. Issues a **scoped, single-use delegated payment token** — a CSPRNG 256-bit random
   token (this is the ACP "shared payment token", NOT encryption; single-use is
   enforced by a DB `UNIQUE` constraint, not by cryptography).
2. Creates a **real Razorpay payment link**.
3. Writes `payment_effect` (pending) + the **Payment Mandate** row (closing the AP2
   Intent→Cart→Payment chain) + audit entries (`token_issued`, `payment_effect`).
4. Moves the session to `PAYING`. Idempotent via a DB `ON CONFLICT` claim — a retry
   with the same key returns the same link and never double-charges.

`on_payment_paid` (webhook) → `COMPLETED`, `running_spend_paise += amount` (the
authorization-hold commit). `on_payment_failed` → clean failure, **no hallucinated
success**. **4 tests.**

### 2.9 `gateway` — the human-facing control plane
The gateway (:8080) is where the human and the payment rail talk to the system:
- `POST /identity` → mints a bearer token (the stable backend identity).
- `POST /mandates` / `GET /mandates` → create (signed) & list mandates.
- `POST /mandates/{id}/revoke` → **instant revocation** (the "kill the agent's
  authority" button).
- `GET /sessions/{id}` → live session state + running spend.
- `GET /sessions/{id}/audit` → the narrated, hash-verified audit chain.
- `GET /audit`, `GET /audit/entries/{id}/context` → the audit explorer.
- `GET /mandates/{id}/runs`, `DELETE .../runs/{run_id}` → console run history.
- `GET /catalog/categories` → the category list for the mandate form.
- `POST /webhooks/razorpay` → HMAC-verifies the raw body, dispatches paid/failed to
  the execution plane. Dependency-free rate limiter + `webhook_event` dedup table.

### 2.10 `harness` — the walking skeleton + adversarial battery
One command runs a full purchase through the *entire* spine (signed intent → cart →
kernel → real payment link → webhook → COMPLETED → verified audit chain). The
`adversarial` bin drives every bound-violation attempt and produces
`docs/BOUNDS_HOLD.md` (**10/10 bounds hold**).

---

## 3. The Python agentic pipeline (7 services)

The agent side is where the *reasoning* lives. Its guiding principle: **the agent
proposes, the kernel disposes** — every worker returns a typed proposal, and the
only thing that can move money is the kernel behind the storefront's `checkout` tool.

### 3.1 `services/agent` — the orchestrator + workers
- **`precheck.py`** — deterministic checks that run *before any LLM call*: mandate
  validity, prompt-injection sanitisation, request budget. An expired/missing mandate
  is rejected here with **zero LLM calls** (asserted on the call counter).
- **`orchestrator.py`** — owns the Purchase Session flow and is the **only component
  allowed to call `checkout`** (enforced by a runtime guardrail *and* a source-level
  structural test). It runs prechecks → parses the goal (LLM) → delegates to workers
  → advances state only on typed returns. States: `PRE_CHECK_FAILED`, `CLARIFY`,
  `CHOOSE`, `UPSELL`, `NEEDS_HUMAN`, `REFUSED`, `AUTHORIZED`.
- **`workers/discovery.py`** — searches the storefront, bounded to the mandate's
  allowed categories/merchants; reranks with the trained relevance model.
- **`workers/cart_composer.py`** — builds the cart and scores purchase confidence;
  proposes a value-ranked upsell complement (read-only — never auto-adds).
- **`workers/clarification.py`** — asks a specific follow-up on genuine ambiguity
  instead of guessing.
- **`llm.py`** — Gemini client (provider-agnostic, retry, call counter), with a
  deterministic heuristic fallback if the LLM is unavailable — the kernel still gates
  everything, so degrading the parse stays safe.
- **`db.py`** (`PgDb`) — reads the mandate/session; writes the append-only
  `agent_run` console log. Uses the shared connection pool.

### 3.2 `services/api` — the FastAPI agent API (:8092)
A thin HTTP shell over the orchestrator. Models, LLM, ML, MCP client, and a shared
DB **connection pool** are built once at startup. Endpoints: `POST /sessions/{id}/run`
(+ `/select`, `/upsell`, `/approve`), their SSE `/stream` variants (real per-stage
progress, not a timed animation), and the campaign endpoints. Every route is
authenticated (bearer token) and session-owner-checked.

### 3.3 `services/relevance`, `services/upsell`, `services/confidence` — the 3 trained models
- **Relevance** — an XGBoost reranker trained on **Amazon ESCI** (MiniLM embeddings +
  lexical features). NDCG@10 improved **0.9096 → 0.9202** over keyword baseline on
  held-out data.
- **Upsell** — a market-basket / complement model from **Instacart + ESCI-C + Amazon
  Reviews 2023** (category→complement table), with a **semantic bridge**: it shares
  the relevance ranker's MiniLM embedder so an unseen catalog category ("sneakers")
  maps to the nearest trained key ("footwear") and still finds complements. Among
  equally-valid complements it prefers the **highest-priced** one (revenue-directed).
- **Confidence** — a gradient-boosted Purchase Confidence Scorer; a below-threshold
  cart routes to `NEEDS_HUMAN` citing the scorer (held-out ROC-AUC ~0.999 on
  synthesised scenarios).

All three load best-effort (`ml_loader.py`) — optional, so CI/tests run without the
trained artifacts.

### 3.4 `services/campaign` — the campaign orchestrator (in-app cross-sell / win-back)
A **pure deterministic rule engine** (`engine.py`) that only ever proposes a
natural-language goal + a human-readable reason — it never touches money. Two rules:
**"complete the set"** (reuses the exact `CartComposer.find_upsell` logic against the
mandate's most recent completed purchase) and **"win-back"** (fires when the last
purchase is >14 days old). Accepting a nudge runs its `suggested_goal` through the
*same* kernel-gated `/run` pipeline. `campaign_offer` is an append-only read-model
log with a 24h cooldown and dismissal-exclusion (won't re-nag a declined item or
category). This is the honest, on-thesis version of "campaign orchestration" — no
email/SMS/scheduler infrastructure the product doesn't have.

### 3.5 `services/explain` — the audit narrator
`Narrator` writes a faithful one-sentence, past-tense narrative into
`audit_entry.narrative` for every entry. **Crucial invariant: the LLM describes,
never decides.** It's fed a decision that *already happened* and asked only to explain
it; the narrative is a separate field **not part of the hash chain**, so it can never
change a money outcome and never affects `verify_chain`. Fired fire-and-forget after
each purchase step, so it never adds latency; degrades to a deterministic sentence on
failure.

### 3.6 `workflows` — the durable Temporal spine
`PurchaseApprovalWorkflow` provides the durable human-approval wait + mandate-TTL
timer for the AFA (>₹15,000) path. A session paused at `NEEDS_HUMAN` **survives a
worker crash + restart** and resumes on approval — verified live, with **exactly one
`payment_effect`** after kill/restart/approve (no double-execution across a crash).

---

## 4. The end-to-end purchase workflow (the full loop)

Here is exactly what happens, step by step, for *"buy running shoes under ₹3,000"*:

1. **Identity & mandate.** The human mints a bearer token (`POST /identity`, gateway)
   and signs an Intent Mandate (`POST /mandates`): budget, per-txn cap, allowed
   categories/merchants, TTL, and the natural-language goal stored alongside. The
   mandate is **ed25519-signed**; a `purchase_session` is bound to it. → audit:
   `session_created`.

2. **Goal → agent-api.** The frontend calls `POST /sessions/{id}/run` (SSE stream).
   The orchestrator runs **deterministic prechecks** (mandate valid? not revoked? not
   expired? within request budget?) — *before any LLM call*.

3. **Parse.** The LLM parses the goal into a structured `Intent` (query, price
   ceiling, category, ambiguity). If genuinely ambiguous → `CLARIFY` (a real
   follow-up question). The human can refine in place ("actually, under ₹2,000")
   continuing the same run.

4. **Discover.** The discovery worker calls `search_catalog` (bounded to the
   mandate's allowed categories/merchants), reranked by the relevance model. If >1
   plausible match → `CHOOSE`: the agent **does not guess** which brand/style/price
   the human wants; it offers options and the human picks (`POST /select`).

5. **Compose + propose.** The cart composer calls `create_cart` (→ a persisted Cart
   Mandate, `cart_built` audit event) and scores confidence. If a real, in-stock,
   in-budget, in-scope complement exists → `UPSELL`: it *proposes* it with a stated
   reason. The agent **never adds it on its own**; the human accepts/declines.

6. **Gate.** The orchestrator (and only the orchestrator) calls `checkout`. The
   storefront hands the cart to the **kernel**, which runs the 9 checks in order and
   returns `approved` / `refused(reason)` / `needs_human`. → audit: `gate_decision`
   with the cited rule. An over-limit cart is **refused here, before any money moves**.

7. **Authorize (execution plane).** On `approved`, the execution plane issues a
   single-use delegated token, creates a **real Razorpay payment link**, writes
   `payment_effect(pending)` + the **Payment Mandate** (closing the AP2 chain), and
   moves the session to `PAYING`. → audit: `token_issued`, `payment_effect`.

8. **Confirm (webhook).** Razorpay fires `payment_link.paid`; the gateway
   HMAC-verifies the raw body and calls `on_payment_paid` → session `COMPLETED`,
   `running_spend += amount`. → audit: `payment_effect(success)`.

9. **Explain + audit.** The narrator writes a plain-language sentence per entry. The
   human reads the complete **hash-verified chain** at `GET /sessions/{id}/audit`:
   `session_created → cart_built → gate_decision → token_issued →
   payment_effect(pending) → payment_effect(success)`, each linked to the prior hash,
   `verify_chain() = PASS`.

**The AFA branch (>₹15,000):** step 6 returns `needs_human`; the Temporal workflow
pauses durably until the human approves (PIN-equivalent), then resumes to step 7 —
crash-safe throughout.

**The refusal branch (the hero moment):** any bound violation returns a typed refusal
at step 6 with a plain-language explanation — the agent declines cleanly, never
crashes, never fakes success. Revoke the mandate mid-session and the very next
attempt is refused `mandate_revoked`.

---

## 5. The data model (8 migrations)

| Migration | Adds | Role |
|---|---|---|
| `0001_init` | merchant, catalog_item, intent_mandate, purchase_session, cart_mandate, gate_decision, reserve_block, payment_effect, audit_entry | The 9 core entities. Money is BIGINT paise with CHECK constraints; pgvector + uuid-ossp extensions. |
| `0002_hardening` | `UNIQUE(delegated_token)`, `webhook_event` dedup table | Single-use token; idempotent webhooks. |
| `0003_revocation` | `revoked_at` on mandate | Instant revocation. |
| `0004_identity` | `identity` table | Bearer-token identity + ownership. |
| `0005_runs` | `agent_run` | Durable per-run console history (stable `run_id` idempotency key). |
| `0006_payment_mandate` | `payment_mandate` | Closes the AP2 Intent→Cart→Payment chain (authority_ref, agent_present, cart_hash). |
| `0007_campaign_offer` | `campaign_offer` | Append-only nudge log (shown/accepted/dismissed). |
| `0008_campaign_offer_category` | `category` column | Win-back dismissal exclusion at category granularity. |

The **audit_entry** table is the non-repudiation backbone: hash-chained, with a
separate `narrative` field the narrator writes (outside the hash).

---

## 6. The mandate chain (AP2) + shared token (ACP) — the protocols, borrowed correctly

Paybound speaks the field's language by implementing the actual patterns:

- **AP2 (Google Agent Payments Protocol)** — the authorization pattern. The
  **Intent → Cart → Payment mandate chain**, each a signed credential chained to the
  last, is fully realized: `IntentMandate` (ed25519-signed bounded envelope with the
  NL goal), `CartMandate` (exact cart, hash-chained to the intent), `PaymentMandate`
  (agent-presence signal + authority reference alongside the real charge). This
  produces a complete non-repudiable audit trail.

- **ACP (OpenAI + Stripe Agentic Commerce Protocol)** — the checkout pattern. The
  merchant stays merchant-of-record; the **shared payment token** (scoped, single-use)
  is the conduit; **the agent never holds a money tool** — it can only call the
  storefront's MCP tools, and only the storefront's execution plane charges via
  Razorpay.

- **Catalog standards** — schema.org JSON-LD + product feed + MCP tools + an ARD
  manifest, covering all three layers (discovery / indexing / interaction) rather
  than betting on one unsettled standard.

Razorpay is the **PSP / token issuer**; the merchant stays **merchant-of-record** —
exactly the real four-party model.

---

## 7. Where the product stands vs. the problem statement

The statement has 8 requirements. Scored against the *live code*:

| Requirement | Status | Evidence |
|---|---|---|
| Transactable **end-to-end** | ✅ Strong | Signed goal → search → cart → kernel → **real** Razorpay link → webhook → COMPLETED. Runs twice in a row. |
| **Agent-readable catalog** | ✅ Strong | 5 MCP tools + schema.org + feed + agents.txt/ARD — all three catalog layers. |
| **Conversational checkout** | ✅ Solid | NL goal, real clarifying questions, in-place refinement of an open CLARIFY/CHOOSE; structured accept/decline once a cart is gated (a deliberate boundary, documented). |
| **Upsell / cross-sell** | ✅ Strong | Trained complement model, semantic bridge, value-ranked, reason-stated, never auto-added. |
| **Campaign orchestration** | ✅ On-thesis | In-app win-back / cross-sell nudges through the kernel-gated pipeline; honest scope (no fake email/SMS infra). |
| **Every money action explainable** | ✅ Strong | LLM narrator (describes, never decides) + a typed reason on every refusal. |
| **Bounded and gated** | ✅ **Crown jewel** | Pure kernel, 9 typed reasons, all pre-spend, **10/10 adversarial bounds hold**, real ₹15,000 AFA threshold, full AP2 chain. |
| **Audit trail + graceful failure** | ✅ Strong | SHA-256 hash chain, `verify_chain` tamper-tested, live revocation, clean over-budget refusal, no hallucinated success. |

**7 of 8 clauses are strong; the 8th (conversational) is solid with a stated,
principled boundary.** Critically, the build is strongest exactly where the problem
statement puts the weight — the five safety clauses.

---

## 8. Novelty & why this is the strongest build (the judge-facing case)

**1. It builds the thing that doesn't exist yet — in the open.** Razorpay's marquee
capabilities (UPI Reserve Pay's fund-blocking, the Claude pilot) are **closed-pilot
only, with no public self-serve API.** Indian commentators (Medianama, NPCI) and
Citibank's Prag Sharma have publicly named the gap: agent-specific spend caps,
per-merchant limits, instant revocation, a cryptographic authority layer — *"none of
the three exist yet."* Paybound implements exactly that loop in test mode. It's not a
re-skin of ChatGPT checkout; it's the missing trust layer, built against a gap the
panel can verify against their own product boundaries.

**2. The trust layer is the architecture, not a feature.** Five of eight requirements
are about safety. Paybound puts a **pure, deterministic, exhaustively-tested kernel**
at the dead center — the agent is *structurally incapable* of overspending because
over-limit actions are removed from the choice set before it acts. In a payments
company evaluating whether to trust agent autonomy, this gate is worth more than any
chatbot cleverness. It's the direct analogue of a compliance kernel: autonomy with a
leash the agent cannot slip.

**3. The whole protocol stack, named and implemented correctly.** AP2 mandate chain
for authorization, ACP shared-token + merchant-of-record for checkout, MCP +
schema.org for the catalog, the real ₹15,000 RBI AFA threshold as the human-approval
gate. Fluency in Intent Mandate / Cart Mandate / shared payment token / revoke /
merchant-of-record is the fastest credibility with a Razorpay panel — and here it's
in running code, not slides.

**4. Rust for the money path is a genuine engineering signal.** The gate, the ledger,
and the execution plane are memory-safe, deterministic, and compile-time SQL-checked.
The kernel is a **pure function with zero I/O** — the strongest possible statement
that the trust boundary is testable and can't be wrong. Backed by **34 Rust + 60
Python tests** and a scripted adversarial battery.

**5. Radical honesty as a differentiator.** `docs/HONEST_METRICS.md` states plainly
what's real (MCP tools, AutoPay caps, payment links, test-mode payments, the whole
kernel) vs. simulated (Reserve-Pay fund-block — because Razorpay has no public API
for it — and synthesized catalog prices). Stating the platform's true boundaries
reads as integrity, not weakness — the opposite of a demo that pretends.

**6. The refusal is the hero, and it's a first-class path.** Every entrant shows the
happy path. Paybound scripts the graceful refusal (over-budget declines cleanly, with
a reason) and **live revocation** (human revokes mid-session → next attempt blocked)
as designed, logged, non-hallucinated flows — the single most differentiated 60
seconds in this track, because no incumbent publishes it.

**The one-line pitch:** *Razorpay already shipped an MCP server and a closed Claude
pilot — agent-transactable merchants are where they're going. Paybound is the
self-serve, bounded, auditable, open version of exactly that, with the trust layer as
the product and the shopping as the demo.*

---

## 9. Verification posture (why you can trust the above)

- **34 Rust tests** (kernel 13, ledger 5, reserve 5, execution 4, plus gateway,
  storefront, common, domain) — pure gate logic, hash chain, property tests, webhook
  dedup, single-use token.
- **60 Python tests** — orchestrator, workers, campaign engine, narrator, ML, plus
  the workflow crash-safety test.
- **10/10 adversarial bounds hold** (`docs/BOUNDS_HOLD.md`) — every violation blocked
  with the correct typed reason.
- **4 scripted end-to-end demos** — happy-path+upsell, graceful over-budget refusal,
  live revocation, >₹15k crash-safe human-approval pause.
- **Real Razorpay test-mode** payment links, dashboard-visible, HMAC-verified
  webhooks.

*Companion docs: `PROGRESS.md` (phase-by-phase), `DECISIONS.md` (every non-obvious
choice), `HONEST_METRICS.md` (real vs simulated), `BOUNDS_HOLD.md` (the adversarial
table), `INTEGRATION_MAP.md` (frontend↔backend).*
