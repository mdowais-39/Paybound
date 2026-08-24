#!/usr/bin/env bash
# Crash-safety demo: a NEEDS_HUMAN purchase paused in a durable Temporal workflow
# survives the worker being KILLED and RESTARTED, then resumes on approval with
# no double payment. Requires: infra + Temporal up (--profile workflow), .env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PAYBOUND_DATABASE_URL="$DATABASE_URL"
export STOREFRONT_URL="http://localhost:8093"
export PYTHONUTF8=1
PYBIN="${PYBIN:-$HOME/miniconda3/envs/paybound/python.exe}"
SFPORT=8093

echo "==> building ..."; cargo build -q -p storefront-mcp -p harness

echo "==> starting storefront (execution) on :$SFPORT ..."
PAYBOUND_STOREFRONT_PORT=$SFPORT ./target/debug/storefront-mcp.exe >/tmp/pb_dur_sf.log 2>&1 &
SF=$!; trap 'kill $SF $WK 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf "$STOREFRONT_URL/health" >/dev/null && break; sleep 0.5; done

echo "==> seeding an AFA (>Rs.15,000) purchase paused at NEEDS_HUMAN ..."
SEED=$(./target/debug/afa_seed.exe)
SESSION=$(echo "$SEED" | grep '^SESSION=' | cut -d= -f2)
ITEM=$(echo "$SEED" | grep '^ITEM=' | cut -d= -f2)
mcp() { curl -s -X POST "$STOREFRONT_URL/mcp" -H "Content-Type: application/json" -d "$1"; }
CART=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"create_cart\",\"arguments\":{\"session_id\":\"$SESSION\",\"items\":[{\"item_id\":\"$ITEM\",\"qty\":1}]}}}")
CART_ID=$("$PYBIN" -c "import sys,json;print(json.load(sys.stdin)['result']['structuredContent']['cart_id'])" <<<"$CART")
VERDICT=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"checkout\",\"arguments\":{\"session_id\":\"$SESSION\",\"cart_id\":\"$CART_ID\",\"afa_approved\":false}}}" | "$PYBIN" -c "import sys,json;print(json.load(sys.stdin)['result']['structuredContent']['verdict'])")
echo "    checkout verdict: $VERDICT  (session now NEEDS_HUMAN)"

start_worker() { "$PYBIN" -m workflows.worker >/tmp/pb_dur_wk.log 2>&1 & WK=$!; for _ in $(seq 1 20); do grep -q "worker started" /tmp/pb_dur_wk.log && break; sleep 0.5; done; }

echo "==> starting worker + the durable workflow (waits for approval) ..."
start_worker
WF=$("$PYBIN" -m workflows.client start "$SESSION" "$CART_ID" 3600)
sleep 2

echo "==> !!! KILLING the worker mid-session (simulating a crash) ..."
kill "$WK" 2>/dev/null || true; sleep 2
echo "    worker is dead; the workflow state lives in Temporal."

echo "==> restarting the worker ..."
start_worker

echo "==> human approves -> workflow resumes and authorizes the payment ..."
"$PYBIN" -m workflows.client approve "$WF"

echo ""
echo "==> verifying: session advanced + exactly ONE payment (no double charge) ..."
docker compose -f deploy/docker-compose.yml exec -T postgres psql -U paybound -d paybound -c \
  "SELECT (SELECT state FROM purchase_session WHERE session_id='$SESSION') AS session_state,
          (SELECT count(*) FROM payment_effect WHERE session_id='$SESSION') AS payment_effects;"
kill "$WK" 2>/dev/null || true
echo "Done."
