# Paybound — Evaluation Harness

The evidence that the bounds are real and the demo is repeatable.

## 1. The adversarial battery (bounds hold)

```bash
cargo run -p harness --bin adversarial
```

Deliberately attempts every violation and asserts each is blocked at the kernel
gate with the correct typed reason. Prints the table and writes
[`docs/BOUNDS_HOLD.md`](../docs/BOUNDS_HOLD.md). Exits non-zero if any bound fails.

Coverage: signature tamper, expired TTL, over per-txn cap, over cumulative
budget, out-of-category, out-of-merchant, price-drift/cart-integrity, the
₹15,000 AFA gate (→ needs_human), and instant revocation.

## 2. The demo scenarios (deterministic, scripted)

| # | Scenario | Script |
|---|---|---|
| 1 | Happy path + accepted upsell | `scripts/agent_demo.sh` |
| 2 | Graceful over-budget refusal | `scripts/agent_demo.sh` |
| 3 | Live revocation (human kills authority mid-session) | `scripts/revocation_demo.sh` |
| 4 | > ₹15,000 human-approval pause + crash-safe resume | `scripts/durable_demo.sh` |

Supporting demos: `scripts/walking_skeleton.sh` (full purchase + hash-verified
audit chain), `scripts/explain_demo.sh` (LLM-narrated audit trail),
`scripts/smoke_storefront.sh` (the five MCP tools over HTTP).

## 3. Honest metrics

Real vs. simulated, stated plainly: [`docs/HONEST_METRICS.md`](../docs/HONEST_METRICS.md).

## 4. The automated test suites

- Rust: `DATABASE_URL=... cargo test --workspace` (kernel bounds, reserve
  property test, audit tamper-detection, storefront/execution/gateway integration).
- Python: `pytest services workflows` (pre-check zero-LLM, ambiguity→clarify,
  needs-human pause/resume, workers-cannot-checkout, durable workflow).
