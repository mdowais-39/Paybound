# Paybound — System Architecture & Frontend Specification

*The trust-and-authorization layer that makes a merchant safely transactable by an AI buyer, on Razorpay test-mode rails.*

This document is the single reference for building the frontend against the backend. It covers:

1. [What the system is](#1-what-the-system-is) — one paragraph
2. [Component inventory](#2-component-inventory) — every service, worker, agent, and what it outputs
3. [How it all connects](#3-end-to-end-flow) — the end-to-end flow
4. [API contract](#4-api-contract) — every endpoint, request, and response shape
5. [Data shapes / TypeScript types](#5-shared-data-shapes-typescript) — the shared contract
6. [Frontend specification](#6-frontend-specification) — pages, components, functions, states
7. [Gaps: new backend endpoints the frontend needs](#7-backend-endpoints-the-frontend-needs-not-yet-built)

---

## 1. What the system is

Paybound lets an **AI shopping agent** buy from a merchant on a customer's behalf **without ever being able to overspend, buy the wrong thing, or move money on its own**. The customer signs a bounded **mandate** (a budget, a per-purchase cap, allowed categories/merchants, an expiry). The agent shops, but a deterministic **Rust kernel** gates every purchase against that mandate before any rupee moves, and only a server-side execution plane — never the agent — can create the actual Razorpay payment. Every action is written to a **hash-chained, tamper-evident audit ledger** with a plain-English narration. The product is the *governance layer*, not the shopping chatbot.

**The core invariant:** *the agent proposes; the kernel disposes.* The agent literally has no tool that spends money — its only spending path is `checkout`, which submits a cart to the kernel and gets back a yes/no.

---

## 2. Component inventory

The system is **polyglot**: a Rust trust core (deterministic, exhaustively tested) and a Python AI layer (the reasoning). They meet at one typed boundary — the **MCP storefront**.

### 2A. Rust services (the trust core)

| Crate | What it is | Key output |
|---|---|---|
| **`kernel`** | The **Mandate & Consent Kernel** — the crown jewel. A pure, zero-I/O function: given a cart + mandate + running spend + time, returns approve or a typed refusal. | `KernelDecision::Approved(Authorization)` or `Refused(RefusalReason)` |
| **`storefront-mcp`** | The merchant's **MCP server**: the 5-tool surface the agent shops through, plus the agent-discovery surface. Runs as an HTTP server. | JSON-RPC tool results; discovery docs |
| **`execution`** | The **execution plane**: the *only* component that talks to Razorpay. Turns a kernel `Authorization` into a real payment link; handles webhook completion. Idempotent. | `AuthorizeResult { razorpay_ref, short_url }` |
| **`gateway`** | The **public API + webhook receiver**: audit-chain reads, mandate revocation, Razorpay webhook verification. Rate-limited. | JSON audit chains; revocation acks |
| **`ledger`** | The **hash-chained audit ledger** + all DB repositories (Postgres). Append-only, SHA-256 linked. | Audit entries; `verify_chain()` verdict |
| **`reserve`** | The **Reserve-Pay ledger** primitive (SIMULATED — no public Razorpay API): reserve → multi-debit → revoke, enforcing the cumulative cap. | Reserve block state |
| **`domain`** | Shared pure types: money (`Paise`), the session state machine, verdicts, audit event kinds, the mandate model (ed25519-signed). | Types only — no I/O |
| **`razorpay-client`** | Thin Razorpay REST client: create payment links, verify webhook HMAC. | `plink_*` objects |
| **`common`** | Config, telemetry (OpenTelemetry), errors, ed25519 signing. | — |
| **`harness`** | Dev/demo binaries: `adversarial` (the bounds-hold table), `walking-skeleton`, `agent_demo_seed`, `try_it_seed`. | Evidence + seeds |

**The 5 MCP tools** (the agent's entire vocabulary — it can do nothing else):

| Tool | Input | Output | Spends money? |
|---|---|---|---|
| `search_catalog` | `query`, `limit?` | `{ items: CatalogItem[] }` | No |
| `get_availability` | `item_id` | `{ item_id, available, price_paise }` | No |
| `get_variants` | `item_id` | `{ item_id, variants }` | No |
| `create_cart` | `session_id`, `items[]` | `CartView` | No |
| `checkout` | `session_id`, `cart_id`, `afa_approved?` | `CheckoutResult` (kernel verdict) | **Triggers** payment link server-side *only if the kernel approves* — the agent never sees a "pay" tool |

**The 9 kernel bounds** (each an independently-tested predicate; the *first* failure is the one cited, in this order):

1. `mandate_revoked` — the human killed the mandate (checked first, always wins)
2. `signature_invalid` — the mandate's ed25519 signature doesn't verify (tamper)
3. `mandate_expired` — past the TTL
4. `cart_integrity_mismatch` — claimed total/hash ≠ actual contents (price drift)
5. `category_not_allowed` — an item's category is off the allow-list
6. `merchant_not_allowed` — the cart's merchant is off the allow-list
7. `over_per_txn_cap` — cart total > per-transaction ceiling
8. `over_cumulative_budget` — running spend + this cart > total budget
9. `requires_human_afa` — over ₹15,000 → **`needs_human`** (not a refusal — a route to human approval)

### 2B. Python AI layer (the reasoning)

The agent is a **pipeline that narrows authority at each layer**, not a free-roaming LLM.

| Component | Role | Output |
|---|---|---|
| **Orchestrator** (`orchestrator.py`) | Owns the session flow. The **only** component allowed to call `checkout`. Runs deterministic pre-checks *before any LLM call*, parses the goal, delegates to workers, advances state on their typed returns. | `OrchestratorResult` |
| **Pre-checks** (`precheck.py`) | Deterministic gate *before* the LLM: mandate active? goal free of prompt-injection? request budget not exhausted? A failure means **zero LLM tokens spent**. | `PrecheckResult { ok, reason }` |
| **Discovery worker** (`workers/discovery.py`) | Calls `search_catalog`, filters to mandate-allowed categories/merchants, ranks (trained relevance model or heuristic). Proposes candidates — never builds a cart. | `Candidate[]` |
| **Cart-Composer worker** (`workers/cart_composer.py`) | Calls `create_cart`, folds in one upsell complement (in an allowed category, within budget), scores purchase confidence. Cannot checkout. | `ComposedCart { cart_id, total_paise, confidence }` |
| **Clarification worker** (`workers/clarification.py`) | Fires on ambiguous intent or low confidence. Asks a follow-up **instead of guessing**. Touches no tools. | A question string |
| **LLM client** (`llm.py`) | Provider-agnostic (Gemini today, pinned model). Tracks a `.calls` counter to *prove* no LLM call happens before pre-checks pass. | Parsed JSON |
| **MCP client** (`mcp_client.py`) | The agent's *only* channel to the merchant — the storefront `/mcp` endpoint. | Tool results |

**The 3 trained ML models** (Phase 7 — each degrades to a heuristic if its artifact is missing):

| Model | Trained on | Job |
|---|---|---|
| **Relevance ranker** | Amazon ESCI | Rank search candidates by query relevance |
| **Upsell model** | Instacart + ESCI-C + Amazon Reviews 2023 | Suggest a complementary category |
| **Purchase Confidence Scorer** | Synthesized labelled features (gradient-boosted classifier) | Score whether the cart truly matches intent — low → route to human. **Not** an LLM self-report. |

### 2C. Durable workflow (Temporal)

| Component | Role |
|---|---|
| **`PurchaseApprovalWorkflow`** (`workflows/purchase_workflow.py`) | When a session hits `NEEDS_HUMAN` (>₹15,000, or low confidence), it pauses **durably** — waiting for the human-approval signal or the mandate TTL, whichever first. Survives a worker crash/restart; the payment activity is idempotent so nothing double-charges. |

### 2D. The explainability narrator

| Component | Role |
|---|---|
| **Narrator** (`services/explain/narrator.py`) | Runs an LLM over each audit entry and writes a one-sentence plain-English `narrative`. **Describes, never decides** — the narrative is a separate field, *not* part of the hash chain, so it can never change a money outcome. Degrades to a deterministic sentence on LLM failure. |

---

## 3. End-to-end flow

A single purchase, from natural-language goal to a paid session:

```
Customer sets a mandate  ──►  signed Intent Mandate (budget, cap, categories, merchant, TTL)
                                        │
Customer types a goal    ──►  Orchestrator
  "buy running shoes                    │
   under 3000"              1. Pre-checks (deterministic, no LLM):
                              mandate active? injection-free? within request budget?
                                        │  ✗ → PRE_CHECK_FAILED (0 LLM calls)
                                        ▼
                           2. Parse goal (LLM) → Intent { query, max_price, ambiguous }
                                        │  ambiguous → CLARIFY (ask, don't guess)
                                        ▼
                           3. Discovery worker → search_catalog → Candidate[]
                                        │  none → CLARIFY
                                        ▼
                           4. Cart-Composer → create_cart (+upsell) → confidence score
                                        │  low confidence → NEEDS_HUMAN
                                        ▼
                           5. Orchestrator → checkout(session, cart)  ← ONLY spending path
                                        ▼
                     ┌──── Rust Kernel.evaluate() ────┐   (9 bounds, deterministic)
                     │  revoked? sig? ttl? integrity? │
                     │  category? merchant? cap?      │
                     │  budget? AFA(₹15k)?            │
                     └────────────┬───────────────────┘
                         approved │ refused │ needs_human
                                  ▼         ▼          ▼
              Execution plane   REFUSED   NEEDS_HUMAN (Temporal pause)
              → real Razorpay   (typed        │  human approves
                payment link     reason)      ▼
              → short_url                    checkout(afa_approved=true)
                     │                             │
                     ▼                             ▼
             Customer pays the rzp.io link  ──► webhook: payment_link.paid
                     │                             │
                     ▼                             ▼
              Execution plane completes  ──►  session COMPLETED

Every step above appends to the hash-chained audit ledger, later narrated in plain English.
```

**Session states** (the `purchase_session.state` machine):
`DELEGATED → SHOPPING → CART_BUILT → GATING → AUTHORIZED → PAYING → COMPLETED`
plus the three first-class off-ramps: `REFUSED`, `NEEDS_HUMAN`, `REVOKED`.

**Audit event types** (what shows up in the trail):
`session_created, pre_check_passed, pre_check_failed, worker_dispatched, confidence_scored, cart_built, gate_decision, token_issued, payment_effect, revoked, narrative_ready`

---

## 4. API contract

There are **three network surfaces**. Ports are the defaults used across the scripts.

### 4A. Gateway (public API) — `http://localhost:8080`

The frontend's primary backend. Rate-limited (200 req burst / 200 rps).

**Identity & ownership.** Every mandate/session endpoint below except `POST /identity` and `GET /catalog/categories` requires `Authorization: Bearer <token>`, and enforces that the caller only sees/acts on **their own** mandates and sessions — not anyone else's. This closes what used to be a real gap (anyone with a session ID could read anyone's audit trail or revoke anyone's mandate).

#### `POST /identity`
Mint a bearer token. No auth required (this is how a caller gets one). The raw token is returned **exactly once** — only its SHA-256 hash is ever stored, so store it client-side (e.g. `localStorage`) and it can't be recovered if lost; mint a new one instead.
```json
// 200 OK
{ "token": "pb_08f28071ade04782b6018cf50dd3388e" }
```
Send it on every subsequent call: `Authorization: Bearer pb_08f28071ade04782b6018cf50dd3388e`. The **same token works on both the gateway and the agent API** (§4C) — one identity, both services, verified against the same `identity` table.

#### `GET /health`
Liveness check.
```json
// 200 OK
{ "status": "ok", "service": "paybound-gateway" }
```

#### `GET /sessions/{session_id}/audit` 🔒
The audit-trail read surface — the "why every rupee moved" artifact. Powers the audit viewer. 401 with no/invalid token; 403 if the session belongs to a different identity.
```json
// 200 OK
{
  "session_id": "cdbf21f7-6267-4c34-90e1-287195d925d7",
  "verified": true,                     // hash-chain tamper check
  "entry_count": 6,
  "entries": [
    {
      "seq": 84,
      "event_type": "session_created",
      "prev_hash": null,                // null on the genesis entry
      "this_hash": "4881aea1a5ed…",
      "payload": { "payer": "user_owais", "nl_goal": "buy running shoes under ₹3,000" },
      "narrative": "A purchase session was created for user_owais.",  // null until narrated
      "ts": "2026-08-25T12:34:56Z"
    }
    // …
  ]
}
// 500 on DB error (plain-text body)
```

#### `POST /mandates/{mandate_id}/revoke` 🔒
Instant kill-switch. The very next agent purchase against this mandate is refused with `mandate_revoked`. 403 if the mandate belongs to a different identity.
```json
// 200 OK
{ "mandate_id": "…", "revoked": true }
// 500 on DB error (plain-text body)
```

#### `POST /mandates` 🔒
Create a signed Intent Mandate **and its one bound session** in one call — the frontend's entry point (replaces the old `try_it_seed`/`agent_demo_seed` dev binaries). Every goal the customer later shops with (`POST /sessions/{id}/run` on the agent API, §4C) runs against this **same** session, so `running_spend_paise` correctly accumulates across every purchase made under the mandate — not just the first.
```json
// request — only budget_total_paise and per_txn_cap_paise are required
{
  "payer": "customer",                          // optional, default "customer"
  "budget_total_paise": 1000000,
  "per_txn_cap_paise": 600000,
  "allowed_categories": ["shoes", "sandal"],     // optional — default: every category the merchant sells
  "merchant_id": null,                           // optional — default: "Paybound Demo Store"
  "ttl_seconds": 3600,                           // optional, default 3600
  "nl_goal": "shop within budget"                // optional
}
// 200 OK
{
  "mandate_id": "124dc473-…", "session_id": "377a1359-…",
  "payer": "customer", "budget_total_paise": 1000000, "per_txn_cap_paise": 600000,
  "allowed_categories": [...], "allowed_merchants": ["443ee1c4-…"],
  "ttl_unix": 1787609671, "nl_goal": "shop within budget"
}
// 400 if per_txn_cap_paise > budget_total_paise, either amount <= 0, or no merchant resolves
```

#### `GET /mandates` 🔒
List **the caller's own** mandates newest-first, each joined to its bound session's live state and spend — feeds the Mandate Console directly. Scoped by the bearer token — never returns another identity's mandates.
```json
// 200 OK
[{
  "mandate_id": "…", "payer": "customer", "budget_total_paise": 1000000, "per_txn_cap_paise": 600000,
  "allowed_categories": [...], "allowed_merchants": [...], "ttl_unix": 1787609671, "nl_goal": "…",
  "revoked": false,
  "session_id": "…", "session_state": "AUTHORIZED", "running_spend_paise": 55600
}]
```

#### `GET /sessions/{session_id}` 🔒
A session's live state + spend + its mandate's bounds + its latest cart — what the shop page polls while (or after) the agent runs. 403 if the session belongs to a different identity.
```json
// 200 OK
{
  "session_id": "…", "mandate_id": "…", "state": "PAYING",
  "running_spend_paise": 0, "budget_total_paise": 1000000, "per_txn_cap_paise": 600000,
  "latest_cart_id": "46cc34ed-…"
}
// 404 if the session doesn't exist
```

#### `GET /catalog/categories?merchant_id=`
Distinct categories the (optionally specified, else default) merchant sells — feeds the mandate form's category picker.
```json
// 200 OK
["cellular phone case", "shoes", "chair", "sandal", ...]
```

#### `POST /webhooks/razorpay`
Razorpay → Paybound. Not called by the frontend. Verifies HMAC-SHA256 over the raw body; dispatches `payment_link.paid` / `.cancelled` / `.expired` / `payment.failed` to the execution plane. Idempotent (replayed deliveries acknowledged, not re-processed).
Returns `200` (handled/ignored), `401` (bad signature), `400` (bad JSON), `500` (handler error).

### 4B. Storefront MCP — `http://localhost:8081` (demo scripts vary the port)

The agent's channel. The frontend generally does **not** call `/mcp` directly (that's the agent's job) but **does** use the discovery + read endpoints.

**Real, multi-merchant catalog.** The demo catalog spans **five distinct, non-overlapping merchants** (~2,950 items), built from two genuinely different real datasets — not one dataset re-skinned:
- **Paybound Demo Store** (general, ~1000 items) — ABO, all brands except the specialty ones below
- **Stone & Beam Living** (furniture, ~300 items) — real ABO brands "Stone & Beam"/"Rivet"
- **AmazonBasics Essentials** (electronics/utility, ~400 items) — real ABO brand "AmazonBasics"
- **Amazon Collection Jewelers** (fine jewelry, ~250 items) — real ABO brand "Amazon Collection"
- **Paybound Fresh Grocery** (grocery, ~1000 items) — a **separate dataset** (Instacart Market Basket: real product names + real aisle/department taxonomy)

Prices are synthesized (both datasets ship no prices), deterministic per item, disclosed openly — same honesty pattern as the rest of the project. The premium categories (sofa, television, chair, watch, ring, earring, necklace) are priced to realistically span the ₹15,000 AFA threshold — **272 items now naturally exceed it**, so the kernel's `requires_human_afa` gate (§ below) can be demoed with an organic purchase request ("buy a gold diamond ring") rather than an artificially rigged mandate. A mandate's `allowed_merchants` (§4A `POST /mandates`) supports scoping to any one of the five; pass `merchant_id`. `GET /catalog/categories?merchant_id=` returns the right list for whichever merchant is selected.

**Search retrieval.** `search_catalog` matches if **any** query term is present (not all of them), so a phrase like "study table" still finds real matches (e.g. "...Side Table") even though no title literally contains the word "study" — the trained relevance ranker (MiniLM + XGBoost) then reranks that pool for true relevance. It's still literal-term matching, not full semantic embedding search (the schema has an unused `vector(384)` column reserved for that as a future upgrade) — so an extremely oblique phrasing can still occasionally miss, but the common "one word doesn't match verbatim" case that used to zero out results is fixed.

#### `POST /mcp` — JSON-RPC 2.0
Methods: `initialize`, `tools/list`, `tools/call`. Example:
```json
// request
{ "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{ "name":"search_catalog","arguments":{ "query":"phone case","limit":3 } } }
// response
{ "jsonrpc":"2.0","id":3,"result":{
    "content":[{ "type":"text","text":"…" }],
    "structuredContent":{ "items":[ /* CatalogItem[] */ ] },
    "isError":false } }
```
`checkout` returns a `CheckoutResult` in `structuredContent` (see §5).

#### `GET /health` → `"ok"`
#### `GET /.well-known/agents.txt` → plain text (agent-discovery: MCP endpoint, ARD, feed, authority note)
#### `GET /.well-known/ard.json` → the ARD manifest (name, tools, `authority_required`)
#### `GET /feed.json` → product feed `{ version, products: [{ id, title, category, price:{value_minor_units,currency}, availability }] }`
#### `GET /schema/{item_id}` → schema.org `Product`/`Offer` JSON-LD

### 4C. Agent API (Python, FastAPI) — `http://localhost:8092`

A thin HTTP shell around the existing `Orchestrator` — no new business logic, just an HTTP handle onto it. Models/LLM/MCP client are built once at process startup, not per request. Both endpoints below require `Authorization: Bearer <token>` — **the same token minted by the gateway's `POST /identity`** (§4A); this service checks the same `identity` table and the same per-session ownership rule.

#### `POST /sessions/{session_id}/run` 🔒
Run the agent on one natural-language goal, against a session created by `POST /mandates` (§4A). Safe to call repeatedly on the same session for a new goal each time.
```json
// request
{ "goal": "buy running shoes under 3000" }
// 200 OK — an OrchestratorResult (see §5), plus:
{
  "state": "AUTHORIZED", "message": "Approved. Complete payment: https://rzp.io/rzp/…",
  "verdict": "approved", "rule_cited": null,
  "payment_link": "https://rzp.io/rzp/…", "clarification_question": null,
  "cart_id": "46cc34ed-…",
  "trace_id": "6c3693abc207316a62753e3b8b0635d8",   // distributed-trace id
  "llm_calls": 1                                     // honesty signal: pre-checks ran before this
}
// 401 missing/invalid token; 403 if the session belongs to a different identity;
// 404 if the session doesn't exist; 500 on an unexpected error
```

#### `POST /sessions/{session_id}/approve` 🔒
Human approval for a `NEEDS_HUMAN` session (the >₹15,000 AFA gate, or a low-confidence match) — resumes checkout with the PIN-equivalent flag set. All other kernel bounds still apply.
```json
// request
{ "cart_id": "50f9fabc-…" }
// 200 OK — same OrchestratorResult shape as /run (llm_calls is 0: approval skips reasoning entirely)
```

#### `GET /health` → `{ "status": "ok", "service": "paybound-agent-api" }`

**Run it:** `bash scripts/run_backend.sh` starts all three services (storefront-mcp :8081, gateway :8080, agent API :8092) together with one command. Or standalone: `uvicorn services.api.main:app --port 8092` (with `STOREFRONT_URL` pointed at a running storefront-mcp).

---

## 5. Shared data shapes (TypeScript)

Drop these into the frontend as the typed contract. `*_paise` values are **integer paise** (₹1 = 100 paise) — never floats. Divide by 100 for display.

```ts
// ---- Catalog ----
interface CatalogItem {
  item_id: string;          // uuid
  merchant_id: string;      // uuid
  title: string;
  category: string;
  price_paise: number;      // integer paise
  availability: boolean;
}

interface CartLineItem {
  item_id: string;
  qty: number;
  price_paise: number;
  category: string;
}

interface CartView {
  cart_id: string;
  session_id: string;
  merchant_id: string;
  line_items: CartLineItem[];
  total_paise: number;
}

// ---- Kernel verdict (what checkout returns) ----
type Verdict = "approved" | "refused" | "needs_human";

type RefusalRule =
  | "mandate_revoked" | "signature_invalid" | "mandate_expired"
  | "cart_integrity_mismatch" | "category_not_allowed" | "merchant_not_allowed"
  | "over_per_txn_cap" | "over_cumulative_budget" | "requires_human_afa";

interface CheckoutResult {
  verdict: Verdict;
  rule_cited: RefusalRule | null;
  human_message: string | null;   // plain-language, ready to show
  amount_paise: number;
  cart_hash: string;
  payment_link: string | null;    // rzp.io/... — present only when approved
  razorpay_ref: string | null;    // plink_...
}

// ---- Agent run result (OrchestratorResult) ----
type SessionOutcome =
  | "AUTHORIZED" | "COMPLETED" | "REFUSED"
  | "NEEDS_HUMAN" | "CLARIFY" | "PRE_CHECK_FAILED";

interface OrchestratorResult {
  state: SessionOutcome;
  message: string;
  verdict: Verdict | null;
  rule_cited: RefusalRule | null;
  payment_link: string | null;
  clarification_question: string | null;
  cart_id: string | null;
  trace_id?: string;              // distributed-trace id, for the trace link
}

// ---- Mandate (the authority the customer signs) ----
interface Mandate {
  mandate_id: string;
  payer: string;
  budget_total_paise: number;
  per_txn_cap_paise: number;
  allowed_categories: string[];
  allowed_merchants: string[];    // uuids
  ttl_unix: number;               // expiry
  nl_goal: string;
  revoked?: boolean;
}

// ---- Session state machine ----
type SessionState =
  | "DELEGATED" | "SHOPPING" | "CART_BUILT" | "GATING"
  | "AUTHORIZED" | "PAYING" | "COMPLETED"
  | "REFUSED" | "NEEDS_HUMAN" | "REVOKED";

// ---- Audit trail ----
type AuditEventType =
  | "session_created" | "pre_check_passed" | "pre_check_failed"
  | "worker_dispatched" | "confidence_scored" | "cart_built"
  | "gate_decision" | "token_issued" | "payment_effect"
  | "revoked" | "narrative_ready";

interface AuditEntry {
  seq: number;
  event_type: AuditEventType;
  prev_hash: string | null;
  this_hash: string;
  payload: Record<string, unknown>;
  narrative: string | null;
  ts: string;                     // RFC3339
}

interface AuditChain {
  session_id: string;
  verified: boolean;
  entry_count: number;
  entries: AuditEntry[];
}
```

---

## 6. Frontend specification

A **Next.js + Tailwind + shadcn/ui** app, built against the typed contract above. Build the whole thing against a **mock layer** (MSW fixtures = the demo scenarios) so it's testable before the new backend endpoints land, then flip one env var (`NEXT_PUBLIC_API_MODE=live`) to go real.

The product has **three surfaces**, matching the three things a customer needs: *set authority*, *shop with it*, *inspect what happened*. This is the heart of the product — not a shopping cart, but a **governance console**.

### Page 1 — Consent & Mandate Console `/mandate`
*Where the customer grants and controls the agent's authority.* This is the product's differentiator — make it feel like signing a contract, not filling a form.

**Must show / do:**
- **Create-mandate form:** total budget (₹), per-transaction cap (₹), allowed categories (multi-select from the live category list), allowed merchant(s), expiry (TTL). Live ₹↔paise conversion; validation (cap ≤ budget, TTL in the future).
- **"Authority preview":** a plain-language playback of what the agent *can* and *cannot* do — e.g. *"This agent may spend up to ₹10,000 total, ₹6,000 per purchase, on footwear or socks, from Demo Store, until 5 PM today."* Builds trust before signing.
- **Active mandates list:** each with budget used / remaining (a spend meter), status, and a prominent **Revoke** button → `POST /mandates/{id}/revoke`. On success, show the kill-switch confirmation and flip status to `REVOKED`.
- **The ₹15,000 AFA note:** surface that purchases over ₹15,000 will always need explicit human approval, regardless of the mandate.

**Key components:** `MandateForm`, `AuthorityPreview`, `SpendMeter`, `MandateCard`, `RevokeButton`, `CategoryMultiSelect`.

### Page 2 — Conversational Checkout `/shop`
*Where the customer gives the agent a goal in natural language and watches it work.* This is the demo hero.

**Must show / do:**
- **Chat-style input:** the customer types a goal ("buy running shoes under 3000"). Fires the agent run (see §7 endpoint).
- **Live pipeline visualization:** show the stages lighting up — Pre-checks ✓ → Parsing → Searching → Composing cart → **Kernel gate** → outcome. This makes the "agent proposes, kernel disposes" story *visible*. Even a simple stepper is high-impact.
- **Four distinct outcome cards**, driven by `OrchestratorResult.state`:
  - `AUTHORIZED` / `COMPLETED` → green success card: the cart, the amount, and the **real payment link** (button to open `rzp.io/...`; note "pay with UPI `success@razorpay` in test mode").
  - `REFUSED` → amber card: the `human_message` and a chip showing the `rule_cited` (e.g. `over_per_txn_cap`). **Never** a raw error — this is the graceful-failure showcase.
  - `NEEDS_HUMAN` → blue card: "This needs your approval" + an **Approve** button (for the >₹15,000 / low-confidence path) and a Decline. Approve resumes the durable workflow.
  - `CLARIFY` → the agent's follow-up question rendered as a chat bubble; the customer can answer and continue.
- **Trace link:** show the `trace_id` and (optionally) deep-link to Grafana/Tempo — proves the whole path is observable.
- **LLM-call counter:** display `LLM calls made: N` — a subtle but powerful honesty signal (shows pre-checks run *before* the LLM).

**Key components:** `GoalInput`, `PipelineStepper`, `OutcomeCard` (4 variants), `PaymentLinkButton`, `ClarifyBubble`, `ApprovalPrompt`, `TraceBadge`.

### Page 3 — Audit Trail Viewer `/audit/{session_id}`
*Where anyone can verify exactly what happened and why.* This is what a Razorpay reviewer will linger on.

**Must show / do:**
- **The hash-chained timeline:** each `AuditEntry` as a card in `seq` order, showing `event_type`, timestamp, the **plain-English `narrative`**, and (expandable) the raw `payload`.
- **The tamper-evidence badge:** a big, unmissable **`verify_chain() = PASS ✓`** (or a red FAIL) from the `verified` field — this is the cryptographic trust proof. Show the hash linkage visually (each entry's `prev_hash` → previous `this_hash`).
- **Money spotlight:** highlight `gate_decision` and `payment_effect` entries — the "every rupee is accounted for" moments.
- **Poll / refresh:** the narrative arrives asynchronously (`narrative: null` until narrated), so re-fetch to fill it in.

**Key components:** `AuditTimeline`, `AuditEntryCard`, `VerifyBadge`, `HashChainConnector`, `PayloadDrawer`.

### Cross-cutting components & functions
- **`api` client module:** typed wrappers for every endpoint in §4 and §7, with an MSW mock mode behind `NEXT_PUBLIC_API_MODE`.
- **`money.ts`:** `paise → "₹X.XX"` formatting and `₹ → paise` parsing (single source of truth — money is always integer paise).
- **`verdictMeta.ts`:** map each `RefusalRule` → a friendly label, color, and icon (so refusal chips are consistent everywhere).
- **`useSession(session_id)`:** hook that fetches state + audit chain, with polling.
- **Global layout:** a nav across the three surfaces; a "current mandate" summary chip always visible (budget remaining + a quick-revoke).
- **Empty/loading/error states** for every fetch — never a blank screen.
- **Test-mode banner:** a persistent note that this is Razorpay test mode (payments are real API calls but not real money).

### Design principles for this product specifically
1. **Make the bounds visible.** The whole value prop is "it can't overspend" — so *show* the caps, the spend meter, the gate decision. Don't hide the governance; it *is* the product.
2. **Refusals are features, not errors.** Style them as confident, explained decisions (amber, with a reason), never as red crashes.
3. **Cryptographic trust, made legible.** The `PASS ✓` badge and the hash chain should feel tangible and reassuring, not like developer output.
4. **Honesty signals everywhere.** The LLM-call counter, the "test mode" banner, the real `rzp.io` link — these small truths are what win a payments panel.

---

## 7. Backend status: fully HTTP-reachable

**Every endpoint a frontend needs is now built and verified over real HTTP** (curled end-to-end: create → run → audit → revoke → refused-after-revoke → approve, plus the full Rust + Python test suites green and clippy/ruff clean). Nothing in this spec requires shelling out to a binary or a CLI script anymore.

| Method + path | Service | Purpose |
|---|---|---|
| `POST /identity` | gateway :8080 | Mint a bearer token (public) |
| `POST /mandates` 🔒 | gateway :8080 | Create a signed mandate + its session |
| `GET /mandates` 🔒 | gateway :8080 | List the caller's own mandates with live spend + state |
| `GET /sessions/{id}` 🔒 | gateway :8080 | Session state + spend + mandate bounds |
| `GET /sessions/{id}/audit` 🔒 | gateway :8080 | The hash-chained, narrated audit trail |
| `POST /mandates/{id}/revoke` 🔒 | gateway :8080 | Instant kill-switch |
| `GET /catalog/categories` | gateway :8080 | Category list for the mandate form (public) |
| `POST /sessions/{id}/run` 🔒 | agent API :8092 | Run the agent on one goal |
| `POST /sessions/{id}/approve` 🔒 | agent API :8092 | Resume a NEEDS_HUMAN session |

🔒 = requires `Authorization: Bearer <token>` and only permits the owning identity — see §4A "Identity & ownership".

**One command brings up the whole backend:**
```bash
bash scripts/run_backend.sh
```
This starts storefront-mcp (:8081), the gateway (:8080), and the agent API (:8092) together, waits for all three health checks, and prints a ready banner. Ctrl+C stops all three.

**Design note — why one mandate now spans one long-lived session:** `POST /mandates` creates exactly one session with the mandate, and every subsequent `POST /sessions/{id}/run` call reuses that same session for a new goal. This matters for correctness, not just convenience: `running_spend_paise` lives on the session row and is what the kernel checks against `budget_total_paise` — so a customer shopping multiple times against one mandate has their spend correctly tracked *cumulatively*, and the budget cap is genuinely enforced across a shopping session, not silently reset on every purchase.

**Not built (intentionally out of scope for now):** `GET /catalog/search` (a direct catalog browse endpoint) — the frontend's shopping flow goes through the agent (`/sessions/{id}/run`), not a traditional product browser, so this wasn't needed for the spec above. Add it if the frontend design changes to include a plain catalog browsing page.

**Three limitations closed this pass, verified live (not just built):**
- **Auth/ownership** — every mandate/session endpoint now requires a bearer token (`POST /identity`) and enforces per-identity ownership. Verified with two separate identities: the non-owner got 403 on read, revoke, *and* on running the agent against the other's session; the owner's own calls succeeded normally.
- **Multi-merchant** — the catalog now has two real, non-overlapping, brand-distinct merchants (general store + a furniture specialty), not one. Verified a mandate scoped to only the specialty merchant correctly returned only its categories and found/authorized a real item from its catalog.
- **Search recall** — `search_catalog` now matches on any query term, not all of them; verified the two known-broken cases from manual testing ("office chair", "study table") both now return correct, sensibly-ranked results.

---

*Prices are always integer paise. The kernel is the only gate on money. The agent has no tool that spends. Every rupee is on the hash-chained ledger. Build the UI to make those four truths obvious.*
