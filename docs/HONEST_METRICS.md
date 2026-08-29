# Paybound — Honest Metrics: Real vs. Simulated

The track rewards honesty. Here is exactly what runs on real rails and what is
simulated — stated plainly, in code comments, and here.

## Real (not mocked)

| Capability | Evidence |
|---|---|
| Razorpay **test-mode payment links** | Real `plink_*` objects created via `POST /v1/payment_links`, payable at their `rzp.io` URL, visible in the dashboard. |
| **Webhook** verification | HMAC-SHA256 over the **raw** body, constant-time; `payment_link.paid` completes the session. |
| MCP **storefront tools** | `search_catalog / get_availability / get_variants / create_cart / checkout` over a real catalog DB; discovery surface (`agents.txt`, ARD manifest, schema.org, feed). |
| The **Mandate & Consent Kernel** | Pure, exhaustively-tested Rust gate; every bound enforced pre-spend. See `docs/BOUNDS_HOLD.md`. |
| **ed25519-signed** mandate chain | Real signatures over canonical JSON; tamper → `signature_invalid`. |
| **Hash-chained audit ledger** | SHA-256 linked, tamper-evident; `verify_chain` proven in tests and live. |
| The **₹15,000 AFA gate** | Real RBI threshold; > ₹15,000 → `needs_human` (PIN-equivalent approval). |
| **Idempotency** | Every money call carries a key; `ON CONFLICT` claim + single-use delegated token (UNIQUE). |
| **Durable workflow** | Real Temporal server; NEEDS_HUMAN pause survives a worker crash/restart. |
| The **three ML models** | Relevance trained on **Amazon ESCI**; upsell from **Instacart** + **ESCI-C** + **Amazon Reviews 2023**; the Purchase Confidence Scorer is a trained gradient-boosted classifier. |

## Simulated (honestly labelled everywhere)

| Thing | Why simulated | How |
|---|---|---|
| **UPI Reserve-Pay fund-block** | Razorpay exposes **no public self-serve API** for it (it powers the closed Claude pilot). | Modelled as a ledger primitive: reserve → multi-debit → revoke, enforcing the cumulative cap. This is the very loop that today only runs in Razorpay's closed pilot — built in the open. |
| **Catalog prices (₹)** | Amazon Berkeley Objects has real titles/categories/variants but **no price**. | Synthesized per category from plausible ₹ ranges, deterministically seeded per item. |
| **UPI AutoPay recurring / S2S UPI** | Not enabled on the test account (S2S UPI 404s). | We use Payment Links instead (real, dashboard-visible). |
| **Webhook receipt in automated scripts** | The real `payment_link.paid` webhook needs a public tunnel to reach localhost. | Scripts drive the receiver with a **correctly-HMAC-signed** synthetic event (identical to Razorpay's). In the live venue the real webhook fires. |

## Conversational checkout — what "conversational" means here

The buyer side takes a natural-language goal, asks a real follow-up question
when it's ambiguous (never guesses), and — as of 2026-08-29 — lets the human
refine an open exchange in place: typing "actually, under 2000" while a
CLARIFY or CHOOSE card is still open continues that same conversation (same
`run_id`, same card, prior wording carried forward so the parser sees full
context) instead of starting an unrelated new purchase. What it is **not** is
an open-ended chat thread that can mutate an already-composed cart mid-turn
("swap the blue one for red") — once a cart is composed and paused at UPSELL,
the accept/decline is a deliberate typed control, not free text, because a
cart that's about to be gated for money is exactly the point past which this
build chooses structure over open dialogue. That's a scoping choice, not an
oversight: a freeform chat that can mutate an already-mandate-gated cart is a
real open design problem (how do you keep "conversational" from becoming a
side-channel around the kernel's own bounds?), not a small feature gap.

## Known limitation

- **Single distributed trace grouping.** All services export OTLP traces and the
  W3C `traceparent` is propagated agent→storefront (verified), but the Rust spans
  don't group under the agent's trace id in this `tracing-opentelemetry` version.
  Per-service traces and the money-path span tree are in Grafana.

## The four demo scenarios (all deterministic + scripted)

1. **Happy path + upsell** — `scripts/agent_demo.sh` (a NL goal → AUTHORIZED + real payment link; upsell adds a complementary item).
2. **Graceful over-budget refusal** — `scripts/agent_demo.sh` (an over-cap goal → REFUSED with a typed reason, no crash).
3. **Live revocation** — `scripts/revocation_demo.sh` (buy → human revokes → next attempt blocked).
4. **> ₹15,000 human-approval pause** — `scripts/durable_demo.sh` (pauses at NEEDS_HUMAN, survives a crash, resumes on approval).

Plus the **bounds-hold table**: `cargo run -p harness --bin adversarial` → `docs/BOUNDS_HOLD.md`.
