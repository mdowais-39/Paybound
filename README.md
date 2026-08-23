# Paybound

**A trust-and-authorization layer that lets an AI shopping agent buy on a human's behalf — on Razorpay's rails — safely, boundedly, and provably.**

Razorpay AI Buildathon · Track 1 (AI Growth & Agentic Commerce).

> The name says the thesis: *payment, bounded*. Every purchase this system makes is provably contained inside a signed budget, category, and time limit **before a rupee moves**.

## What it is

A shopping agent (LangGraph, Python) understands a natural-language goal, searches a real product catalog through an **MCP storefront** (Rust), and proposes a cart. **It can never pay directly.** Every proposed cart is submitted to a **Mandate & Consent Kernel** (Rust) — a pure, exhaustively-tested deterministic function that verifies a cryptographically signed Intent Mandate's bounds (per-transaction cap, cumulative budget, category/merchant, time, cart integrity) and either authorizes or returns a *typed refusal*. Only an approved authorization reaches the **Execution Plane** (Rust), which makes a real Razorpay test-mode payment idempotently. Every step is appended to a **hash-chained audit ledger**, narrated in plain language. A human can **revoke** authority at any instant; the next agent action is blocked.

**The agent proposes; the kernel disposes.**

## Architecture at a glance

- **Deterministic money (Rust):** mandate kernel · execution plane · Reserve-Pay ledger (simulated) · hash-chained audit ledger · MCP storefront.
- **Probabilistic shopping (Python):** LangGraph agent pipeline (pre-checks → Base Agent → Orchestrator → Discovery/Cart-Composer/Clarification workers) over three typed models (Relevance, Upsell, Purchase Confidence).
- **Boundary:** MCP + gRPC, typed hand-off only — never free text the agent could misread.

### What's real vs. simulated (stated plainly, per Part F #7)

- **Real Razorpay test-mode calls:** MCP tools, AutoPay caps, payment links, test payments, `revoke_token`, webhooks.
- **Simulated (no public API):** UPI Reserve-Pay fund-blocking, modelled as a ledger. Labelled as simulated everywhere it appears.

## Repo layout

```
crates/     Rust deterministic core (kernel, ledger, reserve, execution, storefront-mcp, gateway, ...)
services/   Python AI layer (agent pipeline, relevance, upsell, confidence, explain)
proto/      gRPC contracts (Rust <-> Python)
migrations/ sqlx SQL migrations (the 9-entity data model)
deploy/     docker-compose + observability config
eval/       adversarial battery + demo scenario runner
docs/       architecture, build plans, DECISIONS.md, PROGRESS.md
```

## Quickstart (dev)

```bash
# 1. Infra (Postgres, Redis, OTel Collector, Tempo, Grafana)
docker compose -f deploy/docker-compose.yml up -d

# 2. Rust core
cargo test --workspace
cargo run -p gateway        # /health on :8080

# 3. Python env
conda activate paybound
pip install -r requirements.txt
pytest services
```

Copy `.env.example` → `.env` and fill in Razorpay test keys + an LLM API key first.

## Status

Under active development for the Sept 5 buildathon deadline. See `docs/PROGRESS.md` for the phase-by-phase status and `docs/DECISIONS.md` for the engineering decision log.
