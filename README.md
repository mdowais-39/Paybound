<p align="center">
  <img alt="Paybound" src="docs/assets/paybound-logo.png" width="460">
</p>

<h1 align="center">Paybound — Bounded Authority for AI Commerce</h1>

<p align="center">
  <b>Let an AI agent shop and pay on a customer's behalf — without it ever being able to overspend, buy off-mandate, or move money on its own.</b><br>
  A signed spending <i>mandate</i>, a deterministic Rust kernel that gates every purchase before a rupee moves, and a hash-chained audit ledger that proves exactly why each one did.
</p>

<p align="center">
  Built for the <b>Razorpay AI Buildathon — Track 1 (AI Growth &amp; Agentic Commerce)</b>.<br>
  The product is the <i>governance layer</i>, not the shopping bot. <b>The agent proposes; the kernel disposes.</b>
</p>

<p align="center">
  <img alt="Rust" src="https://img.shields.io/badge/trust%20core-Rust%20%2F%20Axum-DEA584?logo=rust&logoColor=black">
  <img alt="Python" src="https://img.shields.io/badge/AI%20layer-Python%20%2F%20FastAPI%20%2F%20LangGraph-3776AB?logo=python&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/frontend-React%20%2F%20TypeScript%20%2F%20Vite-61DAFB?logo=react&logoColor=black">
  <img alt="Postgres" src="https://img.shields.io/badge/database-PostgreSQL%2016%20%2B%20pgvector-4169E1?logo=postgresql&logoColor=white">
  <img alt="Razorpay" src="https://img.shields.io/badge/payments-Razorpay%20test%20mode-0C2451?logo=razorpay&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-hackathon%20build-orange">
</p>

---

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Architecture](#architecture)
4. [Tech Stack](#tech-stack)
5. [Repository Structure](#repository-structure)
6. [Prerequisites](#prerequisites)
7. [Setup & Installation](#setup--installation)
8. [Running the Project](#running-the-project)
9. [Docker Setup & Execution](#docker-setup--execution)
10. [Environment Variables Reference](#environment-variables-reference)
11. [API Access](#api-access)
12. [What's Real vs. Simulated](#whats-real-vs-simulated)
13. [Further Reading](#further-reading)
14. [Testing](#testing)
15. [Troubleshooting](#troubleshooting)

---

## Overview

**Paybound** is a trust-and-authorization layer that makes a merchant safely transactable by an *AI buyer*, on real Razorpay test-mode rails. A customer signs a bounded **Intent Mandate** — a total budget, a per-purchase cap, allowed categories/merchants, and an expiry. An AI shopping agent then works within that mandate, but it has **no tool that spends money**: its only path to a purchase is to submit a proposed cart to a deterministic **Rust kernel**, which gates it against the signed mandate before anything moves. Only a server-side execution plane — never the agent — can create the actual Razorpay payment, and every action is written to a **hash-chained, tamper-evident audit ledger** with a plain-English narration.

The whole system is built around one invariant: **the agent proposes; the kernel disposes.**

Concretely, Paybound gives you:

- **A signed, bounded mandate** — ed25519-signed authority (budget, per-txn cap, categories, merchants, TTL) that the agent cannot forge or exceed.
- **A pure deterministic gate** — the **Mandate & Consent Kernel** (Rust, zero-I/O, exhaustively tested) enforces **nine bounds** in a fixed order and returns either an authorization or a *typed* refusal. No LLM ever decides whether money moves.
- **A real AI buyer** — a LangGraph pipeline (deterministic pre-checks → orchestrator → discovery / cart-composer / clarification workers) backed by **three trained ML models** (relevance ranking, upsell, and a purchase-confidence scorer), talking to the merchant through a real **MCP storefront** (five tools, agent-discovery surface).
- **Real payments** — genuine Razorpay **test-mode payment links** (`plink_*`, `rzp.io/...`), HMAC-verified webhooks, and idempotent money calls.
- **Graceful refusal & instant revocation as first-class states** — a refusal is a typed, explained decision (not a crash); a human can revoke a mandate mid-session and the very next agent action is blocked.
- **Durable human-in-the-loop** — purchases over **₹15,000** (the RBI additional-factor-authentication threshold) pause at `NEEDS_HUMAN` on a **Temporal** workflow that survives a worker crash and resumes on approval.
- **Proof, not vibes** — a SHA-256 hash-chained audit ledger with `verify_chain`, plus an LLM **narrator** that describes each decision in plain English (it describes, it never decides).

The frontend is a **governance console**, not a shopping cart: a place to *set authority*, *watch the agent act within it*, and *inspect exactly what happened and why*.

## Key Features

| Category | What it does |
|---|---|
| **Intent Mandate** | Customer signs a bounded spending authority — total budget, per-transaction cap, allowed categories/merchants, TTL — ed25519-signed over canonical JSON; tampering fails verification |
| **Mandate & Consent Kernel** | A pure, zero-I/O Rust function that gates every cart against the mandate. **Nine bounds**, checked in a fixed order, each independently tested; returns an authorization or a *typed* refusal |
| **MCP Storefront** | The merchant exposed as an agent-shoppable surface: five MCP tools (`search_catalog`, `get_availability`, `get_variants`, `create_cart`, `checkout`) plus an agent-discovery layer (`agents.txt`, ARD manifest, schema.org JSON-LD, product feed) |
| **Agentic buyer pipeline** | Deterministic pre-checks (prompt-injection defense, mandate/budget checks — **zero LLM tokens** spent if they fail) → Orchestrator (the *only* caller of `checkout`) → Discovery / Cart-Composer / Clarification workers |
| **Three trained ML models** | Relevance ranker (Amazon **ESCI**), upsell model (**Instacart** + ESCI-C + Amazon Reviews 2023), and a gradient-boosted **Purchase Confidence Scorer** that routes low-confidence carts to human review — each degrades gracefully to a heuristic if its artifact is absent |
| **Real Razorpay execution** | The execution plane turns a kernel authorization into a genuine test-mode **payment link**; HMAC-SHA256 webhook verification over the raw body; idempotency keys + single-use delegated tokens so nothing double-charges |
| **Campaign & offers** | A merchant campaign engine surfaces contextual offers during a shopping session, resolved through the same mandate-bounded flow |
| **Conversational checkout** | The agent asks a real follow-up when intent is ambiguous (never guesses), and lets the human refine an open request in place ("actually, under 2000") within the same run |
| ⏸️ **Durable human approval** | Purchases over ₹15,000 pause at `NEEDS_HUMAN` on a Temporal workflow that survives a crash and resumes on approval — not an in-memory spinner |
| **Hash-chained audit ledger** | Every event (session, pre-check, worker dispatch, confidence score, gate decision, payment, revocation, narrative) is SHA-256 chained and tamper-evident; `verify_chain` proves integrity |
| **Plain-English narrator** | An LLM writes a one-sentence justification for each audit entry — it *describes* the already-made decision, it never re-opens it, and the narrative is never part of the hash chain |
| **Observability** | OpenTelemetry traces across the money path, exported to Tempo/Grafana; W3C `traceparent` propagated agent → storefront |

## Architecture

```mermaid
flowchart TD
    Client["Client Devices<br/>Web · Mobile"]

    subgraph Backend["Backend"]
        direction TB
        Gateway["Gateway<br/>Rust"]
        Agent["Agent API<br/>Python"]
        Storefront["Storefront<br/>MCP · Rust"]
        Kernel["Kernel<br/>Gate"]
        Execution["Execution<br/>Rust"]
        Temporal["Temporal"]
        PG[("PostgreSQL")]
    end

    Razorpay["Razorpay"]

    Client <-->|"①"| Gateway
    Client <-->|"②"| Agent
    Agent <-->|"③"| Storefront
    Storefront <-->|"④"| Kernel
    Kernel <-->|"⑤"| Execution
    Kernel <-->|"⑥"| Temporal
    Execution <-->|"⑦"| Razorpay
    Gateway <-->|"⑧"| PG
    Storefront <-->|"⑧"| PG
    Execution <-->|"⑧"| PG

    classDef box fill:#d6e8f7,stroke:#2c3e50,stroke-width:1.2px,color:#000
    classDef ext fill:#f2f2f2,stroke:#2c3e50,stroke-width:1.2px,color:#000

    class Gateway,Agent,Storefront,Kernel,Execution,Temporal,PG box
    class Client,Razorpay ext
    style Backend fill:#ffffff,stroke:#2c3e50,stroke-width:1.2px
```

① mandate + revoke + audit · ② goal · ③ MCP tool calls · ④ checkout →
evaluate · ⑤ approved → charge · ⑥ &gt;₹15,000 pause/resume · ⑦ payment link +
webhook · ⑧ persist + audit chain

**Rust crates:** `kernel` · `reserve` · `ledger` · `execution` · `domain` · `razorpay-client` · `gateway` · `storefront-mcp` · `harness` · `common`
**Python services:** `agent/` · `relevance` · `upsell` · `confidence` · `explain/` · `campaign/` · `workflows/`

### The nine kernel bounds (checked in this order; the first failure is the one cited)

`mandate_revoked` → `signature_invalid` → `mandate_expired` → `cart_integrity_mismatch` → `category_not_allowed` → `merchant_not_allowed` → `over_per_txn_cap` → `over_cumulative_budget` → `requires_human_afa` (the last routes to **`needs_human`**, not a refusal).

### Purchase-session state machine

`DELEGATED → SHOPPING → CART_BUILT → GATING → AUTHORIZED → PAYING → COMPLETED`, with the first-class off-ramps `REFUSED` (typed reason), `NEEDS_HUMAN` (> ₹15,000 or low confidence), and `REVOKED`, plus the conversational `CLARIFY` / `CHOOSE` states.

## Tech Stack

| Layer | Technology |
|---|---|
| Trust core (Rust) | Rust 1.90, Axum 0.8, Tokio, Tower/Tower-HTTP, `sqlx` 0.8 (compile-time-checked SQL), `ed25519-dalek`, `sha2`/`hmac`, `reqwest` (rustls), `redis`, OpenTelemetry |
| AI layer (Python) | Python 3.11, LangGraph, FastAPI + Uvicorn, XGBoost, scikit-learn, ONNX / onnxruntime, pandas/numpy, `psycopg`, `temporalio`, `anthropic`/Gemini REST |
| Payments | Razorpay REST (test mode) — payment links + HMAC-SHA256 webhooks |
| Database | PostgreSQL 16 + `pgvector` (catalog embeddings for semantic search) |
| Idempotency | PostgreSQL `ON CONFLICT` claim + `UNIQUE` delegated-token constraint (Redis 7 is provisioned in compose but unused on the live path) |
| Durable workflow | Temporal 1.25 (opt-in `workflow` compose profile) |
| Observability | OpenTelemetry Collector → Tempo → Grafana |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, `react-router-dom` 7, `lucide-react`, `motion`, Firebase (auth), Express (dev/preview host) |
| Infra | Docker / Docker Compose |

## Repository Structure

```
paybound/
├── crates/                      # Rust trust core (Cargo workspace)
│   ├── common/                  #   config, telemetry (OTel), ed25519 signing, errors
│   ├── domain/                  #   shared pure types: Paise, mandate, session state machine, verdicts
│   ├── ledger/                  #   hash-chained audit ledger + sqlx repositories
│   ├── reserve/                 #   Reserve-Pay ledger primitive (cumulative-cap enforcement)
│   ├── kernel/                  #   THE MANDATE & CONSENT KERNEL — pure, zero-I/O, exhaustively tested
│   ├── razorpay-client/         #   Razorpay REST client + HMAC webhook verification
│   ├── execution/               #   execution plane — the ONLY component that talks to Razorpay
│   ├── storefront-mcp/          #   MCP storefront server (5 tools + agent-discovery surface)  :8081
│   ├── gateway/                 #   public API + webhook receiver  :8080
│   └── harness/                 #   dev/demo binaries: adversarial, walking-skeleton, *_seed
├── services/                    # Python AI layer
│   ├── agent/                   #   precheck · orchestrator · base_agent · llm · mcp_client · ml_loader
│   │   └── workers/             #   discovery · cart_composer · clarification
│   ├── api/                     #   FastAPI agent API (run / select / upsell / approve, + SSE)  :8092
│   ├── campaign/                #   merchant campaign / offer engine
│   ├── relevance/               #   relevance ranker (trained on ESCI)
│   ├── upsell/                  #   upsell model (Instacart + ESCI-C + Amazon Reviews)
│   ├── confidence/              #   Purchase Confidence Scorer (gradient-boosted)
│   └── explain/                 #   audit-trail LLM narrator
├── workflows/                   # Temporal durable purchase-approval workflow (worker, activities, client)
├── frontend/                    # React + TypeScript + Vite governance console  :5173
│   ├── src/
│   │   ├── pages/               #   LandingPage · LoginPage · MandatePage · ShopPage · AuditPage
│   │   ├── components/          #   landing · mandate · shop · audit · layout · shared · auth
│   │   ├── context/             #   AuthContext (Firebase) · MandateContext
│   │   └── lib/                 #   api client, types, money, verdict metadata, config, SSE
│   └── server.ts                #   Express host that serves the SPA (no mock backend)
├── data/                        # catalog ingestion (Amazon Berkeley Objects) + pgvector embedding backfill
├── migrations/                  # sqlx SQL migrations (0001_init … 0008_campaign_offer_category)
├── eval/                        # evaluation harness README (adversarial battery + demo scenarios)
├── deploy/                      # docker-compose.yml + OTel / Tempo / Grafana config
├── scripts/                     # run_backend.sh + the four demo scripts + smoke tests
├── proto/                       # (empty — reserved; no gRPC on the live path)
├── docs/                        # architecture, honest-metrics, bounds-hold, decisions, progress, specs
├── .sqlx/                       # sqlx offline query cache (lets the workspace build without a live DB)
├── Cargo.toml                   # Rust workspace manifest
├── requirements.txt             # Python deps
├── pyproject.toml               # ruff + pytest config
└── .env.example                 # copy to .env and fill in
```

## Prerequisites

Install these before you start:

| Tool | Version | Notes |
|---|---|---|
| **Rust & Cargo** | 1.90+ | via [rustup](https://rustup.rs/) — the workspace pins `rust-version = "1.90"` |
| **Python** | 3.11 | a **conda** environment named `paybound` is strongly recommended (the ML services use XGBoost / scikit-learn / onnxruntime) |
| **Node.js & npm** | 18+ | for the frontend (Vite 6 / React 19) |
| **Docker & Docker Compose** | latest | runs all infra — Postgres, Redis, Temporal, OTel/Tempo/Grafana |
| **`sqlx-cli`** | matching `sqlx` 0.8 | to apply migrations — `cargo install sqlx-cli --no-default-features --features rustls,postgres` |
| **A Razorpay account** | test mode | for the `rzp_test_` key ID + secret + webhook secret (free) |
| **A Gemini API key** | — | powers the Orchestrator's goal-parsing and the audit narrator ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) |
| **Git** | any recent | to clone the repo |

> **Note on the datasets & GPU:** the product catalog comes from **Amazon Berkeley Objects** (public AWS Open Data, no login). The three ML models train on **ESCI / Instacart / Amazon Reviews** slices. Everything in this repo runs correctly **CPU-only** — a GPU only speeds up model iteration, it is never required.
>
> **Note on `.sqlx`:** the committed offline query cache means `cargo build` works **without a live database connection** (set `SQLX_OFFLINE=true` if your environment tries to connect at build time). A live DB is only needed to *run* the services and to *add or change* SQL queries.

## Setup & Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd paybound
```

### 2. Configure environment & signing key

```bash
cp .env.example .env
# edit .env — fill in RAZORPAY_KEY_ID / _SECRET / _WEBHOOK_SECRET and GEMINI_API_KEY.
# Leave the localhost DATABASE_URL / ports as-is unless you changed the compose file.
```

Generate the local ed25519 mandate-signing key (git-ignored, never committed — path set by `PAYBOUND_SIGNING_KEY_PATH`, default `./signing_key.ed25519`):

```bash
openssl genpkey -algorithm ed25519 -out signing_key.ed25519
```

> **Tip — rehearse without spending your test-mode payment-link quota:** set `PAYBOUND_DRY_RUN=true` in `.env`. Everything is genuine (kernel gate, audit chain, AUTHORIZED / NEEDS_HUMAN-approve) *except* the actual Razorpay call, which is skipped and shown as a DRY RUN badge. Restore to `false` for real test-mode links.

### 3. Start infrastructure

```bash
docker compose -f deploy/docker-compose.yml --profile workflow up -d
```

This brings up Postgres 16 + pgvector (host port **5433**), Redis, the OTel collector, Tempo, Grafana, and — because of `--profile workflow` — the Temporal server + UI. (Drop `--profile workflow` if you don't need the durable > ₹15,000 approval demo.)

### 4. Apply the database schema

Migrations are **not** run automatically — apply them once before the first launch:

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres   # one-time, if not already installed
export DATABASE_URL="postgres://paybound:paybound@localhost:5433/paybound"  # PowerShell: $env:DATABASE_URL="..."
sqlx migrate run
```

This applies every file in `migrations/` in order (`0001_init` … `0008_campaign_offer_category`). Re-running later is safe — already-applied migrations are skipped.

### 5. Set up the Python AI layer (conda)

```bash
conda create -n paybound python=3.11 -y
conda activate paybound
pip install -r requirements.txt
```

Install PyTorch separately for your platform if you plan to (re)train models — a CPU build is fine (`pip install torch --index-url https://download.pytorch.org/whl/cpu`).

### 6. Ingest the catalog (and embeddings for semantic search)

```bash
conda activate paybound
python data/ingest_abo.py                 # ~1000 items into catalog_item (real ABO attributes; ₹ prices synthesized)
python data/embed_catalog.py              # backfill pgvector embeddings so search is meaning-based, not keyword-only
```

> The trained model artifacts live under `services/{relevance,upsell,confidence}/artifacts/`. If you want to (re)train them yourself: `python -m services.relevance.train`, `python -m services.upsell.train`, `python -m services.confidence.train`. Each service **degrades to a heuristic** if its artifact is missing, so the product still runs before you train anything.

### 7. Build the backend

```bash
cargo build -p storefront-mcp -p gateway
```

### 8. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Running the Project

### Fastest path — one command starts the whole backend

```bash
bash scripts/run_backend.sh
```

This frees any stale ports, builds and starts **storefront-mcp** (`:8081`), the **gateway** (`:8080`), and the **agent API** (`:8092`), waits for all three health checks, and prints a ready banner (including whether `PAYBOUND_DRY_RUN` is on). It assumes infra is up (step 3), `.env` is filled, the `paybound` conda env exists, and the catalog is ingested. `Ctrl+C` stops all three; logs are at `/tmp/pb_backend_{storefront,gateway,agent_api}.log`.

Then, in a separate terminal, start the frontend:

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** — the frontend talks directly to the gateway (`:8080`) and agent API (`:8092`); override those with `VITE_GATEWAY_URL` / `VITE_AGENT_URL` if the backend runs elsewhere.

### Quick smoke test from the terminal

Mandates require a bearer token — mint one from `/identity` first:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/identity | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -X POST http://localhost:8080/mandates \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"budget_total_paise":1000000,"per_txn_cap_paise":600000}'
```

### The four demo scenarios (deterministic, scripted)

```bash
scripts/agent_demo.sh        # 1 & 2: happy path + accepted upsell → AUTHORIZED + real link; and a graceful over-budget REFUSAL
scripts/revocation_demo.sh   # 3: buy → human revokes mid-session → next attempt blocked
scripts/durable_demo.sh      # 4: > ₹15,000 → NEEDS_HUMAN pause, survives a crash, resumes on approval
```

Supporting demos: `scripts/walking_skeleton.sh` (a full purchase + hash-verified audit chain), `scripts/explain_demo.sh` (the LLM-narrated audit trail), `scripts/smoke_storefront.sh` (the five MCP tools over HTTP).

### Service map (once running)

| Service | URL |
|---|---|
| Frontend (governance console) | http://localhost:5173 |
| Gateway API | http://localhost:8080 |
| Gateway health | http://localhost:8080/health |
| Storefront MCP | http://localhost:8081 |
| Storefront health | http://localhost:8081/health |
| Agent API | http://localhost:8092 |
| Agent API health | http://localhost:8092/health |
| Grafana (traces) | http://localhost:3000 |
| Temporal UI | http://localhost:8233 |
| Postgres | localhost:5433 |
| Redis | localhost:6379 |

## Docker Setup & Execution

Docker runs the **infrastructure** — Postgres, Redis, Temporal, and the OTel/Tempo/Grafana observability stack. The Rust services, Python AI layer, and frontend run natively (as above) for fastest local iteration and full model/OCR access.

```bash
# Core infra only (Postgres, Redis, OTel, Tempo, Grafana):
docker compose -f deploy/docker-compose.yml up -d

# Include the durable-workflow stack (Temporal + Temporal UI) for the > ₹15,000 approval demo:
docker compose -f deploy/docker-compose.yml --profile workflow up -d
```

Check status / logs:

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f postgres
```

Stop / reset:

```bash
docker compose -f deploy/docker-compose.yml down       # stop, keep data volumes
docker compose -f deploy/docker-compose.yml down -v     # stop AND wipe Postgres + Tempo volumes (fresh DB next start)
```

> Postgres is published on **5433** (host) → 5432 (container) specifically to avoid clashing with a locally-installed Postgres. Redis is on 6379, OTLP on 4317/4318, Tempo query on 3200, Grafana on 3000, Temporal on 7233, and the Temporal UI on 8233.

## Environment Variables Reference

All live in `.env` at the repo root (copy from `.env.example`). The Rust services read `PAYBOUND_*`; the Python services and `run_backend.sh` read plain `DATABASE_URL` — set both DB vars to the same value.

| Variable | Default | Purpose |
|---|---|---|
| `PAYBOUND_GATEWAY_PORT` | `8080` | Gateway HTTP port |
| `DATABASE_URL` | `postgres://paybound:paybound@localhost:5433/paybound` | Postgres URL (read by Python services + scripts) |
| `PAYBOUND_DATABASE_URL` | *(same as above)* | Postgres URL (read by the Rust services) |
| `PAYBOUND_REDIS_URL` | `redis://localhost:6379` | Redis connection string (provisioned; not used on the live path) |
| `PAYBOUND_OTLP_ENDPOINT` | `http://localhost:4317` | OpenTelemetry collector (OTLP gRPC) |
| `PAYBOUND_SERVICE_NAME` | `paybound-gateway` | Service name reported in traces |
| `RAZORPAY_KEY_ID` | — | Test-mode key ID (`rzp_test_…`) — Razorpay → Test Mode → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | — | Test-mode key secret |
| `RAZORPAY_WEBHOOK_SECRET` | — | Secret for HMAC-SHA256 webhook verification |
| `PAYBOUND_DRY_RUN` | `false` | `true` = skip the real Razorpay call (rehearse without spending payment-link quota); everything else stays genuine |
| `GEMINI_API_KEY` | — | LLM key for the Orchestrator's goal-parsing and the audit narrator |
| `PAYBOUND_SIGNING_KEY_PATH` | `./signing_key.ed25519` | Path to the local ed25519 mandate-signing private key (git-ignored) |

**Frontend overrides** (optional, Vite env): `VITE_GATEWAY_URL` (default `http://localhost:8080`) and `VITE_AGENT_URL` (default `http://localhost:8092`). Firebase config for auth lives in `frontend/src/lib/firebase.ts`.

## API Access

Three network surfaces. The frontend calls the **gateway** and the **agent API**; the **storefront MCP** is the agent's channel.

**Gateway — `http://localhost:8080`** (identity, mandates, sessions, audit, money):

| Method + path | Purpose |
|---|---|
| `POST /identity` | Mint a bearer token (ownership identity for mandates) |
| `POST /mandates` | Create a signed Intent Mandate + its bound session |
| `GET /mandates` | List mandates with live spend + session state |
| `GET /sessions/{id}` | A session's live state + spend + mandate bounds |
| `GET /sessions/{id}/audit` | The hash-chained, narrated audit trail for a session |
| `GET /audit` · `GET /audit/entries/{id}/context` | The global audit log + a single entry's context |
| `POST /mandates/{id}/revoke` | Instant kill-switch |
| `GET /mandates/{id}/runs` · `DELETE /mandates/{id}/runs/{run_id}` | List / delete a mandate's shopping runs |
| `GET /catalog/categories` | Distinct categories for the mandate form |
| `POST /webhooks/razorpay` | Razorpay → Paybound (HMAC-verified; not called by the frontend) |

**Agent API — `http://localhost:8092`** (run the agent on a goal):

| Method + path | Purpose |
|---|---|
| `POST /sessions/{id}/run` · `/run/stream` | Run the agent on one NL goal (plus an SSE progress stream) |
| `POST /sessions/{id}/select` · `/select/stream` | Choose among options in a `CHOOSE` step |
| `POST /sessions/{id}/upsell` · `/upsell/stream` | Accept / decline the composed upsell |
| `POST /sessions/{id}/approve` | Resume a `NEEDS_HUMAN` session (the > ₹15,000 gate) |
| `GET /sessions/{id}/campaign` · `POST /sessions/{id}/campaign/{offer_id}/resolve` | Fetch / resolve a merchant campaign offer |

**Storefront MCP — `http://localhost:8081`** (the agent's channel): `POST /mcp` (JSON-RPC: `search_catalog`, `get_availability`, `get_variants`, `create_cart`, `checkout`), plus the discovery surface `GET /.well-known/agents.txt`, `GET /.well-known/ard.json`, `GET /feed.json`, `GET /schema/{item_id}`.

## What's Real vs. Simulated

The track rewards honesty, and so does this build — the full breakdown is in [`docs/HONEST_METRICS.md`](docs/HONEST_METRICS.md). In short:

**Real (not mocked):** Razorpay test-mode payment links; HMAC-verified webhooks; the five MCP storefront tools over a real catalog DB; the pure exhaustively-tested kernel; ed25519-signed mandates; the SHA-256 hash-chained audit ledger with `verify_chain`; the ₹15,000 AFA gate; idempotency keys + single-use tokens; the durable Temporal pause; and the three trained ML models.

**Simulated (labelled everywhere):** the UPI **Reserve-Pay** fund-block (no public self-serve API exists — it powers Razorpay's closed pilot, so it's modelled here as a ledger primitive); catalog **₹ prices** (ABO ships real attributes but no price, so prices are deterministically synthesized); and, in the automated scripts only, the webhook receipt is driven by a correctly-HMAC-signed synthetic event (the real webhook fires in the live venue).

## Further Reading

| Doc | Covers |
|---|---|
| [`docs/ARCHITECTURE_END_TO_END.md`](docs/ARCHITECTURE_END_TO_END.md) | Full end-to-end architecture walkthrough |
| [`docs/ARCHITECTURE_AND_FRONTEND_SPEC.md`](docs/ARCHITECTURE_AND_FRONTEND_SPEC.md) | Component inventory, API contract, TypeScript shapes, frontend spec + design language |
| [`docs/BOUNDS_HOLD.md`](docs/BOUNDS_HOLD.md) | The adversarial "every bound holds under attack" results table |
| [`docs/HONEST_METRICS.md`](docs/HONEST_METRICS.md) | Real vs. simulated, stated plainly |
| [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md) | The frontend ↔ backend integration audit + wiring map |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) · [`docs/PROGRESS.md`](docs/PROGRESS.md) | Build-decision log + phase-by-phase progress with test results |
| [`eval/README.md`](eval/README.md) | The evaluation harness — adversarial battery + the four demo scenarios |

## Testing

```bash
# Rust — kernel bounds, reserve property test, audit tamper-detection, storefront/execution/gateway integration
export DATABASE_URL="postgres://paybound:paybound@localhost:5433/paybound"
cargo test --workspace

# The adversarial battery — asserts every violation is blocked at the gate with the correct typed reason
cargo run -p harness --bin adversarial      # writes docs/BOUNDS_HOLD.md; exits non-zero if any bound fails

# Python — pre-check zero-LLM, ambiguity→clarify, needs-human pause/resume, workers-cannot-checkout, durable workflow
conda activate paybound
pytest services workflows

# Frontend — unit tests + type-check
cd frontend
npm test
npm run lint       # tsc --noEmit
```

## Troubleshooting

- **The backend "starts then instantly stops."** A stale process from a previous run is still bound to `:8080`/`:8081`/`:8092`. `run_backend.sh` auto-frees these ports on start; if you launched a service manually, kill the old process first (the script's ready banner won't print if a health check never passes).
- **A Rust service panics on boot with a missing-table / relation error.** Migrations haven't been applied — run `sqlx migrate run` with `DATABASE_URL` set (Setup step 4). This is the #1 first-run failure on a fresh clone.
- **`cargo build` tries to reach a database and fails.** Build with the committed offline cache: `SQLX_OFFLINE=true cargo build`. A live DB is only needed to run the services or to add/change SQL queries.
- **The agent API is unhealthy / won't start.** Make sure the `paybound` conda env is activated and `pip install -r requirements.txt` completed, and that `STOREFRONT_URL` points at a running storefront-mcp (the script sets this for you).
- **Search returns weak / keyword-only results.** The pgvector embeddings weren't backfilled — run `python data/embed_catalog.py` after ingesting the catalog.
- **Approved purchases show a "DRY RUN" badge instead of a real payment link.** `PAYBOUND_DRY_RUN=true` is set in `.env`. Set it to `false` and restart the backend for real test-mode links.
- **No payment link is created / Razorpay calls fail.** Confirm `RAZORPAY_KEY_ID` / `_SECRET` are valid **test-mode** keys and that you haven't exhausted the test account's payment-link quota (use dry-run mode to rehearse).
- **The frontend loads but every call fails with a CORS or network error.** Confirm both the gateway (`:8080`) and agent API (`:8092`) are up, and that `VITE_GATEWAY_URL` / `VITE_AGENT_URL` match where they're actually running.
- **The > ₹15,000 approval demo hangs.** The Temporal server isn't running — start infra with `--profile workflow` (Setup step 3) and check the Temporal UI at http://localhost:8233.
- **Traces don't appear in Grafana.** Confirm the OTel collector is up (`docker compose ps`) and `PAYBOUND_OTLP_ENDPOINT` points at `http://localhost:4317`. Note the known limitation (in `HONEST_METRICS.md`): Rust spans currently don't group under the agent's trace id, though per-service traces and the money-path span tree are present.
