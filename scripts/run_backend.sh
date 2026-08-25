#!/usr/bin/env bash
# Bring up the WHOLE backend a frontend needs, with one command:
#   - storefront-mcp (execution wired)  :8081  — catalog + kernel-gated checkout
#   - gateway                            :8080  — mandates, sessions, audit, revoke, webhook
#   - agent API (FastAPI over Orchestrator) :8090  — run a goal, approve NEEDS_HUMAN
#
# All three stay in the foreground (Ctrl+C stops everything). Logs go to
# /tmp/pb_backend_*.log if you need to tail one while it runs.
#
# Requires: infra up (docker compose --profile workflow up -d), .env with
# Razorpay + Gemini keys, the `paybound` conda env, and the catalog ingested.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PAYBOUND_DATABASE_URL="$DATABASE_URL"
export PYTHONUTF8=1
CONDA="${CONDA:-$HOME/miniconda3/Scripts/conda.exe}"

STOREFRONT_PORT="${STOREFRONT_PORT:-8081}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
AGENT_API_PORT="${AGENT_API_PORT:-8092}"

echo "==> building storefront-mcp + gateway ..."
cargo build -q -p storefront-mcp -p gateway

PIDS=()
cleanup() {
  echo ""
  echo "==> stopping backend ..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

echo "==> starting storefront-mcp on :$STOREFRONT_PORT ..."
PAYBOUND_STOREFRONT_PORT="$STOREFRONT_PORT" ./target/debug/storefront-mcp.exe \
  >/tmp/pb_backend_storefront.log 2>&1 &
PIDS+=("$!")

echo "==> starting gateway on :$GATEWAY_PORT ..."
PAYBOUND_GATEWAY_PORT="$GATEWAY_PORT" ./target/debug/gateway.exe \
  >/tmp/pb_backend_gateway.log 2>&1 &
PIDS+=("$!")

for _ in $(seq 1 20); do curl -sf "http://localhost:$STOREFRONT_PORT/health" >/dev/null && break; sleep 0.5; done
for _ in $(seq 1 20); do curl -sf "http://localhost:$GATEWAY_PORT/health" >/dev/null && break; sleep 0.5; done

echo "==> starting agent API on :$AGENT_API_PORT ..."
STOREFRONT_URL="http://localhost:$STOREFRONT_PORT" "$CONDA" run --no-capture-output -n paybound \
  uvicorn services.api.main:app --host 0.0.0.0 --port "$AGENT_API_PORT" \
  >/tmp/pb_backend_agent_api.log 2>&1 &
PIDS+=("$!")
for _ in $(seq 1 40); do curl -sf "http://localhost:$AGENT_API_PORT/health" >/dev/null && break; sleep 0.5; done

echo ""
echo "=================================================================="
echo " Paybound backend is up:"
echo "   storefront-mcp  http://localhost:$STOREFRONT_PORT  (catalog + kernel-gated checkout)"
echo "   gateway         http://localhost:$GATEWAY_PORT  (mandates, sessions, audit, revoke)"
echo "   agent API       http://localhost:$AGENT_API_PORT  (run a goal, approve)"
echo ""
echo " Try it (mandates need a bearer token — mint one first):"
echo "   TOKEN=\$(curl -s -X POST http://localhost:$GATEWAY_PORT/identity | python -c \"import sys,json;print(json.load(sys.stdin)['token'])\")"
echo "   curl -X POST http://localhost:$GATEWAY_PORT/mandates -H \"Authorization: Bearer \$TOKEN\" -H 'content-type: application/json' \\"
echo "        -d '{\"budget_total_paise\":1000000,\"per_txn_cap_paise\":600000}'"
echo "=================================================================="
echo " Ctrl+C to stop. Logs: /tmp/pb_backend_{storefront,gateway,agent_api}.log"

wait
