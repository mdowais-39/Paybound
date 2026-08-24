#!/usr/bin/env bash
# Live revocation demo (the "human is in control" hero moment): the agent buys
# successfully, the human REVOKES the mandate via the gateway, and the agent's
# very next purchase attempt is refused by the kernel. Requires infra + .env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PAYBOUND_DATABASE_URL="$DATABASE_URL"
PYBIN="${PYBIN:-$HOME/miniconda3/envs/paybound/python.exe}"
SFPORT=8096

echo "==> building ..."; cargo build -q -p storefront-mcp -p gateway -p harness

echo "==> starting storefront (:$SFPORT) + gateway (:8080) ..."
PAYBOUND_STOREFRONT_PORT=$SFPORT ./target/debug/storefront-mcp.exe >/tmp/pb_rev_sf.log 2>&1 & SF=$!
PAYBOUND_GATEWAY_PORT=8080 ./target/debug/gateway.exe >/tmp/pb_rev_gw.log 2>&1 & GW=$!
trap 'kill $SF $GW 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf "http://localhost:$SFPORT/health" >/dev/null && curl -sf http://localhost:8080/health >/dev/null && break; sleep 0.5; done

SEED=$(./target/debug/agent_demo_seed.exe); S=$(echo "$SEED" | grep '^SESSION=' | cut -d= -f2)
MANDATE=$(docker compose -f deploy/docker-compose.yml exec -T postgres psql -U paybound -d paybound -tAc "SELECT mandate_id FROM purchase_session WHERE session_id='$S'")
ITEM=$(docker compose -f deploy/docker-compose.yml exec -T postgres psql -U paybound -d paybound -tAc "SELECT item_id FROM catalog_item WHERE category='footwear' AND merchant_id=(SELECT unnest(ARRAY(SELECT jsonb_array_elements_text(allowed_merchants))::uuid[]) FROM intent_mandate WHERE mandate_id='$MANDATE') ORDER BY price_paise LIMIT 1")
mcp() { curl -s -X POST "http://localhost:$SFPORT/mcp" -H "Content-Type: application/json" -d "$1"; }
verdict() { "$PYBIN" -c "import sys,json;print(json.load(sys.stdin)['result']['structuredContent']['verdict'])"; }
cart_id() { "$PYBIN" -c "import sys,json;print(json.load(sys.stdin)['result']['structuredContent']['cart_id'])"; }

echo ""
echo "STEP 1 — the agent buys (authority is valid) ..."
C1=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"create_cart\",\"arguments\":{\"session_id\":\"$S\",\"items\":[{\"item_id\":\"$ITEM\",\"qty\":1}]}}}" | cart_id)
V1=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"checkout\",\"arguments\":{\"session_id\":\"$S\",\"cart_id\":\"$C1\"}}}" | verdict)
echo "   checkout verdict: $V1"

echo ""
echo "STEP 2 — the HUMAN revokes the mandate  (POST /mandates/$MANDATE/revoke) ..."
curl -s -X POST "http://localhost:8080/mandates/$MANDATE/revoke" | "$PYBIN" -c "import sys,json;d=json.load(sys.stdin);print('   ->',d)"

echo ""
echo "STEP 3 — the agent's NEXT purchase attempt is BLOCKED ..."
C2=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"create_cart\",\"arguments\":{\"session_id\":\"$S\",\"items\":[{\"item_id\":\"$ITEM\",\"qty\":1}]}}}" | cart_id)
R2=$(mcp "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"checkout\",\"arguments\":{\"session_id\":\"$S\",\"cart_id\":\"$C2\"}}}")
echo "$R2" | "$PYBIN" -c "import sys,json;r=json.load(sys.stdin)['result']['structuredContent'];print('   checkout verdict:',r['verdict'].upper(),'| rule:',r['rule_cited'],'|',r['human_message'])"
echo ""
echo "The human is in control: one click killed the agent's authority instantly."
