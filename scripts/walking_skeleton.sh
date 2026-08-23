#!/usr/bin/env bash
# Run the Phase 5 walking skeleton: one purchase through the entire spine on
# real Razorpay test-mode rails, ending in a hash-verified audit chain.
# Requires: infra up (docker compose) and .env with Razorpay test keys.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
exec cargo run -q -p harness --bin walking-skeleton
