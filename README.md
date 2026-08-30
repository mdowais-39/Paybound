<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/paybound-logo-dark.svg">
  <img src="docs/assets/paybound-logo.svg" alt="Paybound" width="400">
</picture>

### The trust layer that lets an AI agent shop on your behalf — on Razorpay's rails — safely, boundedly, and provably.

Every purchase this system makes is contained inside a cryptographically signed budget, category, and time limit **— before a rupee moves.**

<br/>

[![Track](https://img.shields.io/badge/Razorpay%20AI%20Buildathon-Track%201-6d28d9?style=flat-square)](#)
[![Rust](https://img.shields.io/badge/Rust-60%20tests%20passing-c2410c?style=flat-square&logo=rust)](#testing)
[![Python](https://img.shields.io/badge/Python-69%20tests%20passing-1d4ed8?style=flat-square&logo=python&logoColor=white)](#testing)
[![Bounds](https://img.shields.io/badge/adversarial%20bounds-10%2F10%20hold-15803d?style=flat-square)](docs/BOUNDS_HOLD.md)
[![Payments](https://img.shields.io/badge/Razorpay-real%20test--mode-072654?style=flat-square)](#real-vs-simulated)

**The agent proposes. The kernel disposes.**

</div>

---

## Table of contents

- [The one-paragraph version](#the-one-paragraph-version)
- [Why this, why now](#why-this-why-now)
- [Architecture — top to bottom](#architecture--top-to-bottom)
- [Screenshots](#screenshots)
- [Features](#features)
- [Edge cases &amp; graceful failure](#edge-cases--graceful-failure)
- [Tech stack](#tech-stack)
- [Repo layout](#repo-layout)
- [Setup](#setup)
- [Running the demos](#running-the-demos)
- [Testing](#testing)
- [Real vs. simulated](#real-vs-simulated)
- [Documentation](#documentation)

---

## The one-paragraph version

A shopping agent (Python) reads a natural-language goal — *"buy running shoes
under ₹3,000"* — searches a real 2,950-item catalog through an **MCP
storefront** (Rust), and proposes a cart. **It can never pay directly.** Every
proposed cart is submitted to a **Mandate & Consent Kernel** (Rust): a pure,
zero-I/O, exhaustively-tested function that checks a cryptographically signed
Intent Mandate's bounds — per-transaction cap, cumulative budget,
category/merchant allow-list, time-to-live, cart integrity — and returns either
an approval or a **typed refusal**. Only an approved authorization reaches the
**Execution Plane**, which makes a real Razorpay test-mode payment,
idempotently. Every step is appended to a **SHA-256 hash-chained audit ledger**
— carrying the real product name, category, and price — and narrated in plain
language. A human can **revoke** authority at any instant; the agent's very
next attempt is blocked.

This is not a shopping chatbot with a mock "buy" button. It is a working
implementation of the trust layer that Indian commentators and Razorpay's own
product boundaries say doesn't exist yet in any self-serve product —
agent-specific spend caps, per-merchant limits, instant revocation, a
cryptographic authority chain — built end-to-end on **real Razorpay test-mode
APIs**.

## Why this, why now

Razorpay has already shipped an MCP server and a closed Claude + NPCI pilot
letting an AI agent complete UPI purchases. The direction is set — but both are
**closed-pilot only, with no public self-serve API**. Commentators (Medianama,
NPCI) are still *proposing* the baseline safeguards this build actually
implements. Citibank's Prag Sharma, at the Feb 2026 India AI Impact Summit,
framed the gap as agents needing "an Aadhaar equivalent, a UPI equivalent, and
an ONDC equivalent" — and said none of the three exist yet.

**Paybound implements that missing loop in test mode, in the open — with the
real ₹15,000 RBI AFA threshold as the human-approval gate, not an invented
number.**

## Architecture — top to bottom

Colour = which stack owns the node. **Peach = Rust** (the deterministic money
path). **Blue = Python** (agentic reasoning + ML). **Purple = React frontend.**
**Red = the kernel gate itself** — the crown jewel. **Green = PostgreSQL. Teal
= Temporal. Light-blue = Razorpay.**

```mermaid
flowchart TD
    subgraph CLIENT["👤 Client &amp; Human Layer — React + TypeScript + Vite · :5173"]
        Human(["🧑 Human Buyer"])
        MandateUI["<b>Consent &amp; Mandate Console</b><br/><i>grant budget · category · TTL · REVOKE</i>"]
        ShopUI["<b>Conversational Shop Console</b><br/><i>NL goal · CHOOSE · UPSELL · live pipeline (SSE)</i>"]
        AuditUI["<b>Audit Trail Viewer</b><br/><i>grouped-by-cart · hash-verified · product detail</i>"]
    end
    Human -->|"grant / revoke authority"| MandateUI
    Human -->|"'buy running shoes under 3000'"| ShopUI
    Human -->|"inspect every rupee"| AuditUI

    subgraph GATEWAY["🚪 Gateway — Rust · axum · :8080"]
        Identity["<b>Identity</b><br/><i>bearer token</i>"]
        MandateEP["<b>Mandate Lifecycle</b><br/><i>ed25519 sign · list · REVOKE</i>"]
        AuditEP["<b>Audit Read API</b><br/><i>hash-verified chain</i>"]
        WebhookEP["<b>Webhook Receiver</b><br/><i>HMAC-SHA256 · raw body</i>"]
    end
    MandateUI -->|"POST /identity · /mandates"| Identity
    MandateUI -->|"POST /mandates/:id/revoke"| MandateEP
    AuditUI -->|"GET /sessions/:id/audit"| AuditEP

    subgraph AGENT["🧠 Buyer Agent — Python · FastAPI · :8092"]
        Precheck["<b>Deterministic Pre-checks</b><br/><i>valid? revoked? expired? · ZERO LLM calls</i>"]
        Orchestrator["<b>Orchestrator</b><br/><i>owns the flow · the ONLY caller of checkout</i>"]
        Workers["<b>Workers</b><br/><i>Discovery · Cart Composer · Clarification</i>"]
        CampaignEng["<b>Campaign Engine</b><br/><i>win-back / complete-the-set · never touches money</i>"]
    end

    subgraph ML["📦 Trained Models + LLM — loaded in-process, no network hop"]
        Gemini["<b>Gemini LLM</b><br/><i>goal parse + audit narration · heuristic fallback</i>"]
        Relevance["<b>Relevance Ranker</b><br/><i>XGBoost · Amazon ESCI · relevance-margin filter</i>"]
        Upsell["<b>Upsell Model</b><br/><i>Instacart + ESCI-C + Reviews · MiniLM bridge</i>"]
        Confidence["<b>Confidence Scorer</b><br/><i>gradient-boosted</i>"]
    end

    ShopUI -->|"POST /sessions/:id/run"| Precheck
    Precheck -->|"pass"| Orchestrator
    Precheck -.->|"reject — typed reason, 0 LLM"| ShopUI
    Orchestrator --> Workers
    Orchestrator -->|"parse goal → 1..N intents"| Gemini
    Workers -->|"rerank + relevance-filter"| Relevance
    Workers -->|"complement · value-rank"| Upsell
    Workers -->|"score purchase confidence"| Confidence
    ShopUI -->|"GET /campaign"| CampaignEng

    subgraph STORE["🏪 Merchant Storefront — MCP · Rust · axum · :8081"]
        MCP["<b>MCP Tools · JSON-RPC 2.0</b><br/><i>search_catalog · get_availability · get_variants · create_cart · checkout</i>"]
        Discovery2["<b>Agent Discovery Surface</b><br/><i>agents.txt · ARD manifest · schema.org JSON-LD · product feed</i>"]
    end
    Workers -->|"MCP tool calls (HTTP JSON-RPC)"| MCP
    Orchestrator ==>|"checkout — the ONLY money call"| MCP
    MCP -.->|"advertised to any external agent"| Discovery2

    subgraph TRUST["🛡️ Trust Core — Rust · the crown jewel"]
        Kernel{{"<b>Mandate &amp; Consent Kernel · HARD GATE</b><br/><i>pure fn · zero I/O · deterministic</i><br/>signature → TTL → cart integrity → category →<br/>merchant → per-txn cap → cumulative budget → AFA → revoked"}}
        Signing["<b>ed25519 Verify</b><br/><i>signed Intent Mandate</i>"]
        Reserve["<b>Reserve-Pay Ledger</b><br/><i>SIMULATED fund-block · block → multi-debit → revoke</i>"]
    end
    MCP ==>|"evaluate(cart, mandate, spend, now)"| Kernel
    Kernel -->|"verify signature"| Signing
    Kernel -->|"cumulative cap vs running spend"| Reserve
    Kernel -.->|"Refused(reason) / NeedsHuman — typed"| Orchestrator

    subgraph EXEC["💳 Execution Plane — Rust · ACP shared-token pattern"]
        PayOrch["<b>Payment Orchestrator</b><br/><i>idempotent · ON CONFLICT claim</i>"]
        Token["<b>Delegated Token Issuer</b><br/><i>scoped · single-use · 256-bit CSPRNG</i>"]
    end
    Kernel ==>|"Approved(Authorization)"| PayOrch
    PayOrch --> Token

    subgraph WF["⏱️ Durable Workflow — Temporal"]
        Approval["<b>PurchaseApprovalWorkflow</b><br/><i>&gt; ₹15,000 AFA · survives crash/restart · exactly-once</i>"]
    end
    Kernel -->|"needs_human (&gt; ₹15k)"| Approval
    Approval -->|"human approves"| PayOrch

    Razorpay[("🔵 Razorpay — Test-Mode REST<br/><i>Payment Links · Orders · webhooks</i>")]
    PayOrch -->|"create_payment_link"| Razorpay
    Razorpay -->|"payment_link.paid"| WebhookEP
    WebhookEP -->|"on_payment_paid → COMPLETED"| PayOrch

    subgraph DATA["🗄️ Data Layer — PostgreSQL 16 + pgvector"]
        PG[("<b>PostgreSQL</b><br/><i>catalog · intent/payment mandates · sessions · carts · runs · offers</i>")]
        Audit[("<b>Hash-chained Audit Ledger</b><br/><i>SHA-256 linked · product line_items · verify_chain()</i>")]
        Vec[("<b>pgvector index</b><br/><i>MiniLM catalog embeddings · semantic search</i>")]
    end
    MCP <-->|"catalog · availability"| PG
    MCP -->|"semantic nearest-neighbour"| Vec
    MandateEP --> PG
    PayOrch -.->|"Payment Mandate — closes the AP2 chain"| PG
    Precheck -.->|"session_created"| Audit
    MCP -.->|"cart_built · gate_decision (+ product detail)"| Audit
    PayOrch -.->|"token_issued · payment_effect"| Audit
    AuditEP --> Audit

    subgraph EXPLAIN["🗣️ Explanation Service — Python"]
        Narrator["<b>Audit Narrator</b><br/><i>describes, NEVER decides · narrative lives outside the hash</i>"]
    end
    Audit -.->|"fire-and-forget, async"| Narrator
    Narrator -.->|"plain-language sentence"| Audit
    Audit ==>|"verify_chain() = PASS"| AuditUI

    Human -.->|"REVOKE — next attempt blocked"| MandateEP
    MandateEP -.->|"revoked_at"| PG

    subgraph OBS["📊 Observability"]
        OTel["<b>OpenTelemetry → Collector → Tempo → Grafana</b><br/><i>money-path traces: agent → MCP → kernel → Razorpay</i>"]
    end
    AGENT -.-> OTel
    STORE -.-> OTel
    EXEC -.-> OTel

    classDef rust fill:#ffedd5,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef python fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:1.5px
    classDef frontend fill:#ede9fe,stroke:#6d28d9,color:#4c1d95,stroke-width:1.5px
    classDef db fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef kernel fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d,stroke-width:3px
    classDef workflow fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:1.5px
    classDef external fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e,stroke-width:1.5px
    classDef obs fill:#f1f5f9,stroke:#475569,color:#1e293b,stroke-width:1.5px
    classDef human fill:#ffffff,stroke:#111827,color:#111827,stroke-width:2px

    class Human human
    class MandateUI,ShopUI,AuditUI frontend
    class Identity,MandateEP,AuditEP,WebhookEP,MCP,Discovery2,PayOrch,Token,Signing,Reserve rust
    class Precheck,Orchestrator,Workers,CampaignEng,Gemini,Relevance,Upsell,Confidence,Narrator python
    class Kernel kernel
    class Approval workflow
    class Razorpay external
    class PG,Audit,Vec db
    class OTel obs

    style CLIENT fill:#faf5ff,stroke:#c4b5fd,color:#4c1d95
    style GATEWAY fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style AGENT fill:#eff6ff,stroke:#93c5fd,color:#1e3a8a
    style ML fill:#eff6ff,stroke:#93c5fd,color:#1e3a8a
    style STORE fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style TRUST fill:#fef2f2,stroke:#fca5a5,color:#7f1d1d
    style EXEC fill:#fff7ed,stroke:#fdba74,color:#7c2d12
    style WF fill:#f0fdfa,stroke:#5eead4,color:#134e4a
    style DATA fill:#f0fdf4,stroke:#86efac,color:#14532d
    style EXPLAIN fill:#eff6ff,stroke:#93c5fd,color:#1e3a8a
    style OBS fill:#f8fafc,stroke:#cbd5e1,color:#1e293b
```

*Standalone annotated version with a stage-by-stage walkthrough:*
**[`docs/ARCHITECTURE_DIAGRAM.md`](docs/ARCHITECTURE_DIAGRAM.md)**. *Prose deep
dive on every crate, service, migration, and the AP2/ACP protocol mapping:*
**[`docs/ARCHITECTURE_END_TO_END.md`](docs/ARCHITECTURE_END_TO_END.md)**.

## Screenshots

<!-- Drop the three PNGs into docs/screenshots/ (see that folder's README for
     exact capture steps) and they render here automatically. -->

| Consent & Mandate Console | Conversational Shop Console | Hash-verified Audit Trail |
|:---:|:---:|:---:|
| <img src="docs/screenshots/mandate-console.png" alt="Consent & Mandate Console" width="270"> | <img src="docs/screenshots/shop-console.png" alt="Shop Console" width="270"> | <img src="docs/screenshots/audit-trail.png" alt="Audit Trail" width="270"> |
| Sign a bounded spending mandate — budget, per-txn cap, categories, TTL — with a live authority-contract preview and the ₹15,000 AFA guarantee. | A natural-language goal drives the live 6-node pipeline; the agent offers real options and never guesses, gated by the kernel before any charge. | Every rupee, grouped by cart: the real product, the narrated reason, the SHA-256 chain link, and a verified badge. |

## Features

- **Agent-readable catalog** — a live MCP JSON-RPC surface (`search_catalog`,
  `get_availability`, `get_variants`, `create_cart`, `checkout`) over 2,950
  real products, plus `agents.txt`, an ARD manifest, schema.org JSON-LD, and a
  product feed. Hybrid pgvector-semantic + lexical retrieval with a trained
  relevance reranker and a relevance-margin filter that drops off-topic
  near-misses.
- **Conversational, multi-product checkout** — a goal can name several products
  ("shoes *and* a phone case"); each one gets its own explicit confirmation,
  never auto-picked. Refining an open choice ("actually, under ₹2,000")
  continues the same exchange in place.
- **Upsell / cross-sell** — a trained co-purchase model proposes a genuine,
  value-ranked complement with a stated reason — never added without an
  explicit accept.
- **Campaign orchestrator** — a deterministic rule engine (never an LLM, never
  money) surfaces in-app win-back / complete-the-set nudges that run through the
  *same* kernel-gated pipeline as any purchase.
- **The Mandate & Consent Kernel** — a pure, zero-I/O Rust function; nine
  ordered checks; **10 / 10** adversarial violations blocked with the correct
  typed reason ([`BOUNDS_HOLD.md`](docs/BOUNDS_HOLD.md)).
- **Hash-chained, product-detailed audit** — SHA-256 linked and tamper-evident
  (`verify_chain()`), carrying real product name/category/price per line item;
  an LLM narrator describes each step but never decides, and its narrative
  lives outside the hash.
- **Durable, crash-safe human approval** — a purchase over ₹15,000 pauses at a
  Temporal workflow, survives a worker crash, and completes exactly once.
- **Instant revocation** — one call, and the agent's very next attempt is
  refused `mandate_revoked`, live.

## Edge cases & graceful failure

The problem statement asks for "one failure handled gracefully." This build
treats graceful failure as a first-class, tested path — here is every case
actually handled, with evidence:

| Scenario | Handling | Cited reason / mechanism |
|---|---|---|
| Cart exceeds the per-transaction cap | Refused, typed, before pricing against Razorpay | `over_per_txn_cap` |
| Cumulative spend would exceed the budget | Refused before money moves | `over_cumulative_budget` |
| Category / merchant outside the mandate | Refused, with the mandate's allow-list quoted back | `category_not_allowed` / `merchant_not_allowed` |
| Cart total or hash doesn't match its contents | Refused — price drift / item substitution caught | `cart_integrity_mismatch` |
| Mandate signature tampered | Refused before any other check | `signature_invalid` |
| Mandate past its TTL | Refused | `mandate_expired` |
| Purchase above ₹15,000 | Paused for human approval — durable, crash-safe, exactly-once | `requires_human_afa` + Temporal |
| Human revokes mid-session | The very next attempt is refused, live | `mandate_revoked` |
| Ambiguous goal ("something nice") | The agent asks a specific follow-up — never guesses | `CLARIFY` |
| No match / over price cap / wrong category | A specific, actionable message naming which axis failed | `_no_match_message` |
| Multi-item order, item 2 has one real match | Still shown as an explicit choice, not silently added | see [DECISIONS.md](docs/DECISIONS.md) |
| Multi-item pick from a different seller | Caught immediately at selection — nothing added | `_merchant_conflict` |
| Off-topic near-miss search results | Filtered by a relevance margin below the top match | see [DECISIONS.md](docs/DECISIONS.md) |
| Duplicate webhook delivery | Deduplicated — processed exactly once | `webhook_event` UNIQUE |
| Duplicate `authorize()` (retry) | Idempotent — same link, never a second charge | `ON CONFLICT` claim |
| LLM provider outage | Deterministic heuristic parse takes over; the kernel still gates everything | `_heuristic_intent` |
| Narrator LLM failure | Falls back to a deterministic sentence; never blocks the chain | `narrate_entry` |
| Payment fails on Razorpay | Recorded as a clean failure — never a hallucinated success | `on_payment_failed` |

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Trust core + money path | **Rust** — 10-crate Cargo workspace, axum, sqlx (compile-time-checked SQL) | Deterministic, memory-safe; the gate must never be wrong |
| Agentic pipeline + ML | **Python 3.11** — FastAPI, a custom LangGraph-style orchestrator | Fast iteration, where the ML/LLM ecosystem lives |
| Durable workflow | **Temporal** (Python SDK) | Crash-safe human-approval pauses, exactly-once execution |
| Frontend | **React + Vite + TypeScript + Tailwind** | The console: shop, mandates, live audit trail |
| Data | **PostgreSQL 16 + pgvector** | One relational store; a vector column for semantic search |
| Payments | **Razorpay test-mode REST** (Payment Links, Orders, webhooks) | Real payment objects, dashboard-visible, HMAC-verified |
| ML | **XGBoost** (relevance, confidence), a co-purchase model, **MiniLM** embeddings | Trained on Amazon ESCI, Instacart, Amazon Reviews 2023 |
| LLM | **Google Gemini** (provider-agnostic client, heuristic fallback) | Parses goals, narrates the audit trail — never decides money outcomes |
| Identity / crypto | **ed25519** (dalek), **SHA-256** | Signed mandates + the hash-chained audit ledger |
| Observability | **OpenTelemetry → OTel Collector → Tempo → Grafana** | Distributed tracing on the money path |

## Repo layout

```
crates/       Rust workspace — kernel, ledger, reserve, execution, storefront-mcp, gateway, harness, domain, common, razorpay-client
services/     Python — agent orchestrator + workers, relevance, upsell, confidence, explain, campaign, api
workflows/    Temporal durable-workflow spine (Python SDK)
frontend/     React + Vite + TypeScript console (mandate, shop, audit pages)
migrations/   sqlx SQL migrations — the full data model (8 migrations)
data/         Catalog ingestion + embedding scripts (Amazon Berkeley Objects, Instacart)
deploy/       docker-compose + observability config (Postgres, Redis, OTel Collector, Tempo, Grafana)
eval/         Adversarial bounds-hold battery + demo scenario runner
scripts/      One-command backend bring-up + scripted demo scenarios
docs/         Architecture, decision log, progress log, honest-metrics, bounds-hold table
```

## Setup

### Prerequisites

Rust (stable) · Python 3.11 · Node.js 18+ · Docker · a Razorpay **test-mode**
key pair · a Gemini API key.

### 1 — Infrastructure

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### 2 — Environment

Copy `.env.example` → `.env` and fill in real values. `.env` is git-ignored —
never commit real keys.

```bash
DATABASE_URL=postgres://paybound:paybound@localhost:5433/paybound
PAYBOUND_DATABASE_URL=postgres://paybound:paybound@localhost:5433/paybound
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
```

### 3 — Database + catalog

```bash
cargo install sqlx-cli --no-default-features --features postgres
sqlx migrate run
python data/ingest_abo.py          # seed the catalog
python data/embed_catalog.py       # backfill semantic-search embeddings
```

### 4 — Build & test the Rust core

```bash
cargo build --workspace && cargo test --workspace
```

### 5 — Python environment

```bash
conda create -n paybound python=3.11 && conda activate paybound
pip install -r requirements.txt && pytest services/
```

### 6 — Frontend

```bash
cd frontend && npm install && npm run dev     # http://localhost:5173
```

### 7 — Bring up the whole backend with one command

```bash
bash scripts/run_backend.sh
```

Starts `storefront-mcp` (:8081), `gateway` (:8080), and the agent API (:8092)
together; logs land in `/tmp/pb_backend_*.log`.

## Running the demos

Scripted, deterministic, no manual setup beyond the steps above:

```bash
bash scripts/agent_demo.sh        # happy path + upsell, and a graceful over-budget refusal
bash scripts/revocation_demo.sh   # live revocation: buy → revoke → next attempt refused
bash scripts/durable_demo.sh      # >₹15,000 pause, worker crash + restart, resumes and completes
bash scripts/explain_demo.sh      # the narrated, hash-verified audit chain for a real purchase

cargo run -p harness --bin walking-skeleton   # one command, the entire spine, end to end
cargo run -p harness --bin adversarial        # the 10-case bounds-hold battery → docs/BOUNDS_HOLD.md
```

## Testing

```bash
cargo test --workspace                     # Rust — 60 tests (kernel, ledger, reserve, execution, storefront, gateway)
cargo clippy --workspace -- -D warnings
pytest services/                           # Python — 69 tests (orchestrator, workers, campaign, ML, workflow)
ruff check services/
cd frontend && npm run test && npm run lint # Frontend — 33 tests + full type check
```

## Real vs. simulated

Stated plainly, because the track rewards honesty over pretending.

**Real, not mocked:** Razorpay test-mode payment links and webhooks
(HMAC-verified), the full Mandate & Consent Kernel, ed25519-signed mandates, the
SHA-256 audit chain, the real ₹15,000 RBI AFA threshold, three models trained on
public datasets (Amazon ESCI, Instacart, Amazon Reviews 2023).

**Simulated, and labelled everywhere:** UPI Reserve-Pay's fund-blocking —
Razorpay exposes no public self-serve API for it (it powers their closed Claude
pilot) — modelled as a ledger primitive (reserve → multi-debit → revoke), the
same loop that today runs only in that closed pilot, built here in the open.
Catalog ₹ prices are synthesized (Amazon Berkeley Objects has real
titles/categories/variants but no price data), deterministically seeded per item.

Full breakdown: [`docs/HONEST_METRICS.md`](docs/HONEST_METRICS.md).

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/ARCHITECTURE_DIAGRAM.md`](docs/ARCHITECTURE_DIAGRAM.md) | The full end-to-end diagram, annotated stage by stage |
| [`docs/ARCHITECTURE_END_TO_END.md`](docs/ARCHITECTURE_END_TO_END.md) | Prose deep-dive: every crate/service, the workflow, the AP2/ACP mapping, the PS scorecard |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every non-obvious engineering decision, dated, with reasoning + verification |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Phase-by-phase build log with STOP-AND-TEST results |
| [`docs/HONEST_METRICS.md`](docs/HONEST_METRICS.md) | The full real-vs-simulated ledger |
| [`docs/BOUNDS_HOLD.md`](docs/BOUNDS_HOLD.md) | The adversarial battery — every attempted violation and its typed refusal |
| [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md) | The frontend-to-backend wiring audit |

---

<div align="center">

**Razorpay AI Buildathon · Track 1 — AI Growth & Agentic Commerce**

*The trust layer is the product. The shopping is the demo.*

</div>
