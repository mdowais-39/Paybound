#!/usr/bin/env bash
# Live agentic-commerce demo: a natural-language goal drives the whole pipeline
# (real Gemini -> storefront MCP tools -> kernel gate -> execution payment link).
# Requires: infra up, .env with Razorpay + Gemini keys, `paybound` conda env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PAYBOUND_DATABASE_URL="$DATABASE_URL"
export PYTHONUTF8=1
CONDA="${CONDA:-$HOME/miniconda3/Scripts/conda.exe}"
PORT=8091

echo "==> building ..."
cargo build -q -p storefront-mcp -p harness

echo "==> starting storefront (execution wired) on :$PORT ..."
PAYBOUND_STOREFRONT_PORT=$PORT ./target/debug/storefront-mcp.exe >/tmp/pb_agent_sf.log 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf "http://localhost:$PORT/health" >/dev/null && break; sleep 0.5; done

run() {  # <goal>
  local session
  session=$(./target/debug/agent_demo_seed.exe | grep '^SESSION=' | cut -d= -f2)
  echo ""
  echo "=================================================================="
  STOREFRONT_URL="http://localhost:$PORT" "$CONDA" run -n paybound \
    python -m services.agent.demo "$session" "$1"
}

run "buy running shoes under 3000"    # happy path -> AUTHORIZED + payment link
run "buy me something nice"           # ambiguous  -> CLARIFY (asks, doesn't guess)
run "buy the premium marathon shoes"  # over per-txn cap -> REFUSED at the kernel
echo ""
echo "Done. The agent never had a money tool — checkout is its only spending path,"
echo "and the Rust kernel gated every decision."
