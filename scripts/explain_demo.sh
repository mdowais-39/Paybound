#!/usr/bin/env bash
# Explanation demo: run one full purchase (walking skeleton), narrate every audit
# entry with the LLM, then read the narrated, hash-verified chain from the
# gateway's audit API. Requires infra up + .env (Razorpay + Gemini keys).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PYTHONUTF8=1
PYBIN="${PYBIN:-$HOME/miniconda3/envs/paybound/python.exe}"

echo "==> building ..."; cargo build -q -p gateway -p harness

echo "==> starting gateway on :8080 ..."
PAYBOUND_GATEWAY_PORT=8080 ./target/debug/gateway.exe >/tmp/pb_explain_gw.log 2>&1 &
GW=$!; trap 'kill $GW 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf http://localhost:8080/health >/dev/null && break; sleep 0.5; done

echo "==> running one full purchase (walking skeleton) ..."
SESSION=$(./target/debug/walking-skeleton.exe 2>/dev/null | grep '^SESSION=' | cut -d= -f2)
echo "    session: $SESSION"

echo "==> narrating the audit chain with the LLM (describes, never decides) ..."
"$PYBIN" -m services.explain.narrator "$SESSION"

echo ""
echo "==> GET /sessions/$SESSION/audit  (the narrated, hash-verified chain) ..."
curl -s "http://localhost:8080/sessions/$SESSION/audit" | "$PYBIN" -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  verified: {d['verified']}   entries: {d['entry_count']}\")
for e in d['entries']:
    print(f\"  #{e['seq']:<2} {e['event_type']:<16} {e['narrative']}\")
"
