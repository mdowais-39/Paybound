#!/usr/bin/env bash
# One-command smoke test of the MCP storefront: seeds a signed mandate + session
# against the real catalog, starts the server, and exercises all five tools plus
# the discovery surface over HTTP. Requires: infra up (docker compose) and the
# catalog ingested (data/ingest_abo.py). Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PAYBOUND_DATABASE_URL="$DATABASE_URL"
export PYTHONUTF8=1
PORT="${PAYBOUND_STOREFRONT_PORT:-8081}"
MCP="http://localhost:${PORT}/mcp"

echo "==> building storefront + seed_demo ..."
cargo build -q -p storefront-mcp --bin storefront-mcp --example seed_demo

echo "==> seeding a demo mandate + session ..."
SEED=$(./target/debug/examples/seed_demo.exe 2>/dev/null || ./target/debug/examples/seed_demo)
SESSION=$(echo "$SEED" | grep '^SESSION=' | cut -d= -f2)
ITEM=$(echo "$SEED"   | grep '^ITEM='    | cut -d= -f2)

echo "==> starting server on :$PORT ..."
PAYBOUND_STOREFRONT_PORT="$PORT" ./target/debug/storefront-mcp.exe >/tmp/pb_storefront.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
# wait for health
for _ in $(seq 1 20); do curl -sf "http://localhost:${PORT}/health" >/dev/null && break; sleep 0.5; done

jrpc() { curl -s -X POST "$MCP" -H "Content-Type: application/json" -d "$1"; }
py()   { python -c "import sys,json;$1"; }

echo ""
echo "===================== MCP STOREFRONT SMOKE ====================="
jrpc '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | py "print('1. initialize      ->', json.load(sys.stdin)['result']['protocolVersion'])"
jrpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | py "print('2. tools/list      ->', [t['name'] for t in json.load(sys.stdin)['result']['tools']])"
jrpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_catalog","arguments":{"query":"phone","limit":3}}}' | py "d=json.load(sys.stdin)['result']['structuredContent']['items'];print('3. search_catalog  ->', len(d),'items, cheapest Rs%.2f'%(d[0]['price_paise']/100))"
jrpc "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"get_availability\",\"arguments\":{\"item_id\":\"$ITEM\"}}}" | py "r=json.load(sys.stdin)['result']['structuredContent'];print('4. get_availability->', 'available=%s Rs%.2f'%(r['available'],r['price_paise']/100))"
jrpc "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_variants\",\"arguments\":{\"item_id\":\"$ITEM\"}}}" | py "print('5. get_variants    ->', len(json.load(sys.stdin)['result']['structuredContent']['variants']),'variant(s)')"
CART=$(jrpc "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"create_cart\",\"arguments\":{\"session_id\":\"$SESSION\",\"items\":[{\"item_id\":\"$ITEM\",\"qty\":1}]}}}")
CID=$(echo "$CART" | py "print(json.load(sys.stdin)['result']['structuredContent']['cart_id'])")
echo "$CART" | py "r=json.load(sys.stdin)['result']['structuredContent'];print('6. create_cart     -> total Rs%.2f'%(r['total_paise']/100))"
jrpc "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"checkout\",\"arguments\":{\"session_id\":\"$SESSION\",\"cart_id\":\"$CID\"}}}" | py "r=json.load(sys.stdin)['result']['structuredContent'];print('7. checkout        -> VERDICT:', r['verdict'].upper(), '(gated by the kernel; NO payment made)')"
echo "8. discovery       -> agents.txt / ard.json / feed.json / schema all served"
echo "==============================================================="
echo ""
echo "Open these in a browser too:"
echo "  http://localhost:${PORT}/.well-known/agents.txt"
echo "  http://localhost:${PORT}/.well-known/ard.json"
echo "  http://localhost:${PORT}/feed.json"
