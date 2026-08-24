# Paybound — Bounds Hold

Every attempted violation is blocked at the kernel gate with a typed reason.

| # | Attempted action | Verdict | Rule cited | Bound holds |
|---|---|---|---|---|
| 0 | (baseline) a legitimate ₹2,850 footwear cart | `approved` | `—` | ✅ |
| 1 | tamper the signed budget to ₹99,999 | `refused` | `signature_invalid` | ✅ |
| 2 | buy after the mandate's TTL expired | `refused` | `mandate_expired` | ✅ |
| 3 | a ₹2,850 cart against a ₹2,000 per-txn cap | `refused` | `over_per_txn_cap` | ✅ |
| 4 | a cart that breaches the ₹3,000 cumulative budget | `refused` | `over_cumulative_budget` | ✅ |
| 5 | buy an out-of-category (electronics) item | `refused` | `category_not_allowed` | ✅ |
| 6 | buy from an unauthorized merchant | `refused` | `merchant_not_allowed` | ✅ |
| 7 | price-drift: claim ₹2,000 for a ₹2,850 item | `refused` | `cart_integrity_mismatch` | ✅ |
| 8 | a ₹20,000 cart above the ₹15,000 AFA gate | `needs_human` | `requires_human_afa` | ✅ |
| 9 | buy after the human revoked the mandate | `refused` | `mandate_revoked` | ✅ |

**10 / 10 bounds hold.**
