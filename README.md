# Paybound

**The trust-and-authorization layer that lets an AI shopping agent buy on a human's behalf — on Razorpay's rails — safely, boundedly, and provably.**

[![Track](https://img.shields.io/badge/Razorpay%20AI%20Buildathon-Track%201-6d28d9)](#)
[![Rust tests](https://img.shields.io/badge/Rust%20tests-60%20passing-b45309)](#testing)
[![Python tests](https://img.shields.io/badge/Python%20tests-69%20passing-1d4ed8)](#testing)
[![Bounds hold](https://img.shields.io/badge/adversarial%20bounds-10%2F10%20hold-15803d)](docs/BOUNDS_HOLD.md)
[![License](https://img.shields.io/badge/status-buildathon%20submission-374151)](#)

> The name says the thesis: **pay, bounded**. Every purchase this system makes is provably contained inside a signed budget, category, and time limit — **before a rupee moves**.

---

## Table of contents

- [What it is](#what-it-is)
- [Why this, why now](#why-this-why-now)
- [Architecture, top to bottom](#architecture-top-to-bottom)
- [Features](#features)
- [Edge cases and graceful failure](#edge-cases-and-graceful-failure)
- [Tech stack](#tech-stack)
- [Repo layout](#repo-layout)
- [Setup](#setup)
- [Running the demos](#running-the-demos)
- [Testing](#testing)
- [Real vs. simulated](#real-vs-simulated)
- [Documentation index](#documentation-index)

---

## What it is

A shopping agent (Python) reads a natural-language goal — *"buy running shoes
under ₹3,000"* — searches a real product catalog through an **MCP storefront**
(Rust), and proposes a cart. **It can never pay directly.** Every proposed
cart is submitted to a **Mandate & Consent Kernel** (Rust): a pure,
zero-I/O, exhaustively-tested function that checks a cryptographically signed
Intent Mandate's bounds — per-transaction cap, cumulative budget,
category/merchant allow-list, time-to-live, cart integrity — and returns
either an approval or a **typed refusal**. Only an approved authorization
reaches the **Execution Plane**, which makes a real Razorpay test-mode
payment, idempotently. Every step — intent captured, cart built, gate
decision, token issued, payment settled — is appended to a **hash-chained
audit ledger** and narrated in plain language. A human can **revoke**
authority at any instant; the agent's very next attempt is blocked.

**The agent proposes. The kernel disposes.**

This is not a shopping-chatbot demo with a mock "buy" button. It is a working
implementation of the trust layer Indian commentators and Razorpay's own
platform boundaries say doesn't exist yet in any self-serve product —
agent-specific spend caps, per-merchant limits, instant revocation, a
cryptographic authority chain — built end-to-end on **real Razorpay
test-mode APIs**.

## Why this, why now

Razorpay has already shipped an MCP server and a closed Claude + NPCI pilot
letting an AI agent complete UPI purchases. The direction is set — but both
of those capabilities are **closed-pilot only, with no public self-serve
API**. Indian commentators (Medianama, NPCI) are still *proposing* the
baseline safeguards this build actually implements: agent-specific spend
caps, per-merchant limits, instant revocation, a cryptographic authority
layer. Citibank's Prag Sharma, at the Feb 2026 India AI Impact Summit,
framed the gap as needing "an Aadhaar equivalent, a UPI equivalent, and an
ONDC equivalent" for agents — and said none of the three exist yet.

Paybound implements that missing loop, in test mode, in the open — with the
real ₹15,000 RBI AFA threshold as the human-approval gate, not an invented
number.

## Architecture, top to bottom

Color = which stack owns the node. **Amber = Rust** (the deterministic money
path). **Blue = Python** (agentic reasoning). **Red = the kernel gate itself.**
**Green = PostgreSQL. Purple = Temporal. Grey = external (Razorpay).**

```mermaid
flowchart TD
    Human(["Human"])

    subgraph FE["Frontend — React + Vite + TypeScript · :5173"]
        MandateUI["Mandate Console<br/>sign budget / caps / TTL"]
        Shop["Shop Console<br/>NL goal to CHOOSE to UPSELL to outcome"]
        AuditUI["Audit Trail Viewer<br/>grouped-by-cart, hash-verified"]
    end

    Human -->|"grant bounded authority"| MandateUI
    Human -->|"'buy running shoes under 3000'"| Shop
    Human -->|"inspect chain / revoke"| AuditUI

    subgraph GW["Gateway — Rust · axum · :8080"]
        Identity["POST /identity<br/>mint bearer token"]
        Mandates["POST /mandates<br/>ed25519-sign Intent Mandate"]
        RevokeEP["POST /mandates/:id/revoke<br/>instant kill-switch"]
        AuditRead["GET /sessions/:id/audit<br/>GET /audit"]
        WebhookEP["POST /webhooks/razorpay<br/>HMAC-SHA256 verified"]
    end

    MandateUI --> Identity
    MandateUI --> Mandates
    AuditUI --> AuditRead
    Human -.->|"revoke — next attempt blocked"| RevokeEP

    subgraph AA["Agent API — Python · FastAPI · :8092"]
        Precheck["Pre-checks<br/>valid? not expired? not revoked?<br/>ZERO LLM calls"]
        Orchestrator["Orchestrator<br/>ONLY caller of checkout"]
        Parse["Intent Parse<br/>LLM to 1 or N products"]
        Discovery["Discovery Worker<br/>bounded search + rerank"]
        Composer["Cart Composer<br/>builds cart, scores confidence"]
        Clarify["Clarification Worker<br/>asks, never guesses"]
        Campaign["Campaign Engine<br/>win-back / complete-the-set"]
    end

    subgraph ML["Trained models + LLM (in-process)"]
        Gemini["Gemini LLM<br/>parse + narrate<br/>heuristic fallback on outage"]
        Relevance["Relevance Ranker<br/>XGBoost on ESCI<br/>+ margin filter"]
        UpsellM["Upsell Model<br/>Instacart + ESCI-C + Reviews<br/>MiniLM semantic bridge"]
        Confidence["Confidence Scorer<br/>gradient-boosted"]
    end

    Shop -->|"POST /sessions/:id/run"| Precheck
    Precheck -->|"pass"| Orchestrator
    Precheck -.->|"fail — typed reason"| Shop
    Orchestrator --> Parse
    Parse --> Gemini
    Orchestrator --> Discovery
    Discovery --> Relevance
    Orchestrator --> Composer
    Composer --> UpsellM
    Composer --> Confidence
    Orchestrator --> Clarify
    Shop -->|"GET /sessions/:id/campaign"| Campaign

    subgraph SF["storefront-mcp — Rust · :8081"]
        MCPSurface["MCP JSON-RPC 2.0<br/>search_catalog · get_availability<br/>get_variants · create_cart · checkout"]
        Discover2["Discovery surface<br/>agents.txt · ARD manifest<br/>schema.org JSON-LD · product feed"]
        KernelGate{{"Mandate and Consent Kernel<br/>pure fn, zero I/O<br/>signature to TTL to cart integrity to<br/>category to merchant to per-txn cap to<br/>cumulative budget to AFA to revoked"}}
        ExecPlane["Execution Plane<br/>single-use delegated token<br/>idempotent ON CONFLICT claim"]
    end

    Discovery -->|"search_catalog"| MCPSurface
    Composer -->|"create_cart"| MCPSurface
    Orchestrator -->|"checkout — ONLY money call"| MCPSurface
    MCPSurface -->|"evaluate(cart, mandate, spend, now)"| KernelGate
    KernelGate -->|"Approved(Authorization)"| ExecPlane
    KernelGate -.->|"Refused(reason) / NeedsHuman"| Orchestrator

    subgraph WF["Temporal — durable workflow"]
        ApprovalWF["PurchaseApprovalWorkflow<br/>survives crash/restart"]
    end
    KernelGate -->|"over 15000 rupees — AFA"| ApprovalWF
    ApprovalWF -->|"human approves"| ExecPlane

    Razorpay[("Razorpay<br/>Test-Mode REST API")]
    ExecPlane -->|"create_payment_link"| Razorpay
    Razorpay -->|"payment_link.paid webhook"| WebhookEP
    WebhookEP -->|"on_payment_paid to COMPLETED"| ExecPlane

    subgraph PG["PostgreSQL 16 + pgvector"]
        CatalogTbl[("catalog_item<br/>2,950 items · 325 categories<br/>5 merchants")]
        MandateTbl[("intent_mandate<br/>payment_mandate")]
        CartTbl[("cart_mandate")]
        AuditTbl[("audit_entry<br/>SHA-256 hash-chained")]
        RunTbl[("agent_run<br/>campaign_offer")]
    end

    MCPSurface <-->|"search / availability"| CatalogTbl
    Mandates --> MandateTbl
    ExecPlane -.->|"Payment Mandate<br/>closes AP2 chain"| MandateTbl
    MCPSurface --> CartTbl
    MCPSurface -.->|"cart_built"| AuditTbl
    KernelGate -.->|"gate_decision<br/>+ real product line_items"| AuditTbl
    ExecPlane -.->|"token_issued<br/>payment_effect"| AuditTbl
    Precheck -.->|"session_created"| AuditTbl
    Orchestrator --> RunTbl
    AuditRead --> AuditTbl

    subgraph EXP["Explanation service — Python"]
        Narrator["Narrator<br/>describes, NEVER decides<br/>narrative outside the hash"]
    end
    AuditTbl -.->|"fire-and-forget, async"| Narrator
    Narrator -.->|"plain-language sentence"| AuditTbl

    AuditTbl -->|"verify_chain PASS"| AuditUI

    classDef rust fill:#fef3c7,stroke:#b45309,color:#78350f,stroke-width:1.5px
    classDef python fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:1.5px
    classDef external fill:#f3f4f6,stroke:#6b7280,color:#374151,stroke-width:1.5px
    classDef db fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef kernel fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d,stroke-width:3px
    classDef workflow fill:#ede9fe,stroke:#6d28d9,color:#4c1d95,stroke-width:1.5px
    classDef human fill:#ffffff,stroke:#111827,color:#111827,stroke-width:2px

    class MandateUI,Shop,AuditUI python
    class Identity,Mandates,RevokeEP,AuditRead,WebhookEP rust
    class Precheck,Orchestrator,Parse,Discovery,Composer,Clarify,Campaign,Gemini,Relevance,UpsellM,Confidence,Narrator python
    class MCPSurface,Discover2,ExecPlane rust
    class KernelGate kernel
    class ApprovalWF workflow
    class Razorpay external
    class CatalogTbl,MandateTbl,CartTbl,AuditTbl,RunTbl db
    class Human human
```

*Full annotated version with a stage-by-stage walkthrough:*
[`docs/ARCHITECTURE_DIAGRAM.md`](docs/ARCHITECTURE_DIAGRAM.md). *Prose deep
dive on every service, every migration, and the AP2/ACP protocol mapping:*
[`docs/ARCHITECTURE_END_TO_END.md`](docs/ARCHITECTURE_END_TO_END.md).

## Features

### Agent-readable catalog
A live MCP JSON-RPC surface (`search_catalog`, `get_availability`,
`get_variants`, `create_cart`, `checkout`) over a real 2,950-item catalog,
plus the static layers an agent platform actually ingests: `agents.txt`, an
Agentic Resource Discovery manifest, schema.org `Product`/`Offer` JSON-LD,
and a product feed. Hybrid retrieval (pgvector semantic + lexical) with a
trained relevance reranker on top.

### Conversational, multi-product checkout
A goal can name more than one product — *"buy running shoes and a phone
case"* — and each one gets its own confirmation: options for every item,
never auto-picked, even when only one real match exists (so a human-visible
choice is never silently skipped because of an internal narrowing). Answering
a clarifying question or refining an open choice ("actually, under ₹2,000")
continues the same exchange in place instead of starting over. Multi-item
carts still respect the single-merchant-per-cart rule — an incompatible pick
is caught immediately with a plain explanation, not a raw error.

### Upsell / cross-sell
A trained co-purchase model (Instacart + Amazon ESCI-C + Amazon Reviews
2023) proposes a genuine complement at checkout, value-ranked among valid
options, with a stated reason ("customers often pair X with Y") — and it is
never added without an explicit accept.

### Campaign orchestrator
A deterministic rule engine (never an LLM, never money) proposes in-app
win-back and complete-the-set nudges from real purchase history. Accepting
one runs through the identical kernel-gated `/run` pipeline as any other
purchase — a nudge can never become a side-channel around the mandate.

### The Mandate & Consent Kernel — the crown jewel
A pure, zero-I/O Rust function. Nine checks in a fixed order — signature,
TTL, cart integrity, category, merchant, per-transaction cap, cumulative
budget, the ₹15,000 AFA threshold, revocation — so the cited refusal reason
is always the most fundamental one. **10 / 10** adversarial violation
attempts blocked with the correct typed reason (see
[`docs/BOUNDS_HOLD.md`](docs/BOUNDS_HOLD.md)).

### Hash-chained, product-detailed audit trail
Every step — session created, cart built, gate decision, token issued,
payment settled — is SHA-256 chained and tamper-evident
(`verify_chain()`). Cart-related entries carry the **real product name,
category, and price** for every line item, not just a total. An LLM narrator
writes a faithful, past-tense sentence per entry — it describes, it never
decides, and the narrative lives outside the hash so it can never affect a
money outcome.

### Durable, crash-safe human approval
A purchase over ₹15,000 pauses at a Temporal workflow, not an in-memory
wait. Kill the worker process mid-pause, restart it, approve — the purchase
resumes and completes exactly once, never double-charged.

### Instant revocation
One call revokes a mandate's authority. The agent's very next attempt —
already in flight or freshly started — is refused `mandate_revoked`, live,
not eventually.

## Edge cases and graceful failure

The problem statement asks for "one failure handled gracefully." This build
treats graceful failure as a first-class, tested path, not an afterthought —
here is every case actually handled, with evidence:

| Scenario | Handling | Evidence |
|---|---|---|
| Cart exceeds the per-transaction cap | Refused, typed reason, before any cart is priced against Razorpay | `over_per_txn_cap` — [BOUNDS_HOLD.md](docs/BOUNDS_HOLD.md) |
| Cumulative spend would exceed the budget | Refused before money moves | `over_cumulative_budget` |
| Category or merchant outside the mandate | Refused, with the mandate's actual allow-list quoted back | `category_not_allowed` / `merchant_not_allowed` |
| Claimed cart total or hash doesn't match its contents | Refused — price drift / item substitution caught | `cart_integrity_mismatch` |
| Mandate signature tampered | Refused before any other check runs | `signature_invalid` |
| Mandate past its TTL | Refused | `mandate_expired` |
| Purchase above ₹15,000 | Paused for human approval — durable, crash-safe, resumes exactly once | `requires_human_afa`, Temporal workflow |
| Human revokes mid-session | The very next attempt is refused, live | `mandate_revoked` |
| Ambiguous goal ("buy me something nice") | The agent asks a specific follow-up — it never guesses | `CLARIFY` state |
| No catalog match, or matches exist but exceed the price cap / mandate category | A specific, actionable message naming which axis failed | `_no_match_message` |
| Multi-item order where item 2 has only one real match | Still shown as an explicit choice, not silently auto-added | see [DECISIONS.md](docs/DECISIONS.md) 2026-08-30 |
| Multi-item pick incompatible with an earlier pick (different seller) | Caught immediately at selection with a clear reason — nothing added | `_merchant_conflict` |
| Search returns near-miss, off-topic results | Filtered by a relevance margin below the top match, not just ranked last | see [DECISIONS.md](docs/DECISIONS.md) 2026-08-30 |
| Duplicate webhook delivery | Deduplicated — processed exactly once | `webhook_event` UNIQUE constraint |
| Duplicate `authorize()` call (retry) | Idempotent — same link returned, never a second charge | `ON CONFLICT` claim on `payment_effect` |
| LLM provider outage | Deterministic heuristic parse takes over; the kernel still gates everything, so safety never depends on the LLM being up | `_heuristic_intent` |
| Narrator LLM failure | Falls back to a deterministic sentence; never blocks or corrupts the audit chain | `narrate_entry` |
| Payment fails on Razorpay's side | Recorded as a clean failure — never a hallucinated success | `on_payment_failed` |

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Trust core + money path | **Rust** — 10-crate Cargo workspace, axum, sqlx (compile-time-checked SQL) | Deterministic, memory-safe; the gate must never be wrong |
| Agentic pipeline + ML | **Python 3.11** — FastAPI, a LangGraph-style orchestrator | Fast iteration, where the ML/LLM ecosystem lives |
| Durable workflow | **Temporal** (Python SDK) | Crash-safe human-approval pauses, exactly-once execution |
| Frontend | **React + Vite + TypeScript + Tailwind** | The console: shop, mandates, live audit trail |
| Data | **PostgreSQL 16 + pgvector** | One relational store; a vector column for semantic search |
| Payments | **Razorpay test-mode REST** (Payment Links, Orders, webhooks) | Real payment objects, dashboard-visible, HMAC-verified |
| ML models | **XGBoost** (relevance, confidence), a co-purchase model, **MiniLM** embeddings | Trained on Amazon ESCI, Instacart, Amazon Reviews 2023 |
| LLM | **Google Gemini** (provider-agnostic client, heuristic fallback) | Parses goals, narrates the audit trail — never decides money outcomes |
| Identity / crypto | **ed25519** (dalek), **SHA-256** | Signed mandates + the hash-chained audit ledger |
| Observability | **OpenTelemetry → OTel Collector → Tempo → Grafana** | Distributed tracing on the money path |

## Repo layout

```
crates/       Rust workspace — kernel, ledger, reserve, execution, storefront-mcp, gateway, harness, ...
services/     Python — agent orchestrator + workers, relevance, upsell, confidence, explain, campaign, api
workflows/    Temporal durable-workflow spine (Python SDK)
frontend/     React + Vite + TypeScript console (mandate, shop, audit pages)
migrations/   sqlx SQL migrations — the full data model, 8 migrations
data/         Catalog ingestion + embedding scripts (Amazon Berkeley Objects, Instacart)
deploy/       docker-compose + observability config (Postgres, Redis, OTel Collector, Tempo, Grafana)
eval/         Adversarial bounds-hold battery + demo scenario runner
scripts/      One-command backend bring-up + scripted demo scenarios
docs/         Architecture, decision log, progress log, honest-metrics, bounds-hold table
```

## Setup

### Prerequisites

- Rust (stable toolchain) + `cargo`
- Python 3.11 (a conda env named `paybound` is assumed by the scripts, but any venv works)
- Node.js 18+ (frontend)
- Docker (Postgres 16 + pgvector, Redis, OTel Collector, Tempo, Grafana)
- A Razorpay **test-mode** key pair
- A Gemini API key (or another provider — the LLM client is provider-agnostic)

### 1. Infrastructure

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### 2. Environment

Copy `.env.example` → `.env` and fill in real values. At minimum:

```bash
DATABASE_URL=postgres://paybound:paybound@localhost:5433/paybound
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
PAYBOUND_GATEWAY_PORT=8080
```

`.env` is git-ignored — never commit real keys.

### 3. Database

```bash
cargo install sqlx-cli --no-default-features --features postgres
sqlx migrate run
python data/ingest_abo.py          # seed the catalog
python data/embed_catalog.py       # backfill semantic search embeddings
```

### 4. Rust workspace

```bash
cargo build --workspace
cargo test --workspace
```

### 5. Python environment

```bash
conda create -n paybound python=3.11 && conda activate paybound
pip install -r requirements.txt
pytest services/
```

### 6. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### 7. Bring up the whole backend with one command

```bash
bash scripts/run_backend.sh
```

This starts `storefront-mcp` (:8081), `gateway` (:8080), and the agent API
(:8092) together, in the foreground; logs land in `/tmp/pb_backend_*.log`.

## Running the demos

Scripted, deterministic, no manual setup beyond the steps above:

```bash
bash scripts/agent_demo.sh        # happy path + upsell, and a graceful over-budget refusal
bash scripts/revocation_demo.sh   # live revocation: buy -> revoke -> next attempt refused
bash scripts/durable_demo.sh      # >₹15,000 pause, worker crash + restart, resumes and completes
bash scripts/explain_demo.sh      # the narrated, hash-verified audit chain for a real purchase
cargo run -p harness --bin walking-skeleton   # one command, the entire spine, end to end
cargo run -p harness --bin adversarial        # the 10-case bounds-hold battery -> docs/BOUNDS_HOLD.md
```

## Testing

```bash
# Rust — 60 tests across kernel, ledger, reserve, execution, storefront, gateway
cargo test --workspace
cargo clippy --workspace -- -D warnings

# Python — 69 tests across the orchestrator, workers, campaign engine, ML models, workflow
pytest services/
ruff check services/

# Frontend — 33 tests + full type check
cd frontend && npm run test && npm run lint
```

## Real vs. simulated

Stated plainly, because the track rewards honesty over pretending:

**Real, not mocked:** Razorpay test-mode payment links and webhooks (HMAC-verified),
the full Mandate & Consent Kernel, ed25519-signed mandates, the SHA-256 audit
chain, the real ₹15,000 RBI AFA threshold, three models trained on public
datasets (Amazon ESCI, Instacart, Amazon Reviews 2023).

**Simulated, and labelled everywhere it appears:** UPI Reserve-Pay's
fund-blocking — Razorpay exposes no public self-serve API for it (it powers
their closed Claude pilot), so it's modelled as a ledger primitive
(reserve → multi-debit → revoke), which is the same loop that today only
runs in that closed pilot, built here in the open. Catalog ₹ prices are
synthesized (Amazon Berkeley Objects has real titles/categories/variants but
no price data), deterministically seeded per item.

Full breakdown: [`docs/HONEST_METRICS.md`](docs/HONEST_METRICS.md).

## Documentation index

| Doc | What's in it |
|---|---|
| [`docs/ARCHITECTURE_DIAGRAM.md`](docs/ARCHITECTURE_DIAGRAM.md) | The full end-to-end Mermaid diagram, annotated stage by stage |
| [`docs/ARCHITECTURE_END_TO_END.md`](docs/ARCHITECTURE_END_TO_END.md) | Prose deep-dive: every crate/service, the purchase workflow, the AP2/ACP mapping, the PS scorecard |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every non-obvious engineering decision, dated, with the reasoning and verification evidence |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Phase-by-phase build log with STOP-AND-TEST results |
| [`docs/HONEST_METRICS.md`](docs/HONEST_METRICS.md) | The full real-vs-simulated ledger |
| [`docs/BOUNDS_HOLD.md`](docs/BOUNDS_HOLD.md) | The adversarial battery — every attempted violation and its typed refusal |
| [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md) | The frontend-to-backend wiring audit and rebuild |

---

*Razorpay AI Buildathon · Track 1 — AI Growth & Agentic Commerce.*
