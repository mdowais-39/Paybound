#!/usr/bin/env bash
# Interactive, free-form purchase test: type any shopping request, in your own
# words, and watch the real pipeline answer it — real Gemini parse, the real
# storefront searching the REAL ingested catalog (not a handful of scripted
# demo items), the Rust kernel gate, and (if approved) a real Razorpay
# test-mode payment link. Good for actually convincing yourself the bounds
# hold, not just watching a script you already know the ending of.
#
# Usage:
#   bash scripts/try_it.sh                 # interactive prompt, ask as many as you like
#   bash scripts/try_it.sh "buy a phone case under 200"   # one-shot
#
# Env overrides (before you start typing):
#   TRY_IT_BUDGET_PAISE=1000000        # this mandate's total budget   (default ₹10,000)
#   TRY_IT_PER_TXN_CAP_PAISE=600000    # this mandate's per-item cap   (default ₹6,000)
#
# Requires: infra up (docker compose), .env with Razorpay + Gemini keys,
# `paybound` conda env, and the catalog ingested (data/ingest_abo.py).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://paybound:paybound@localhost:5433/paybound}"
export PAYBOUND_DATABASE_URL="$DATABASE_URL"
export PYTHONUTF8=1
CONDA="${CONDA:-$HOME/miniconda3/Scripts/conda.exe}"
PORT=8095

echo "==> building ..."
cargo build -q -p storefront-mcp -p harness

echo "==> starting storefront (execution wired) on :$PORT ..."
PAYBOUND_STOREFRONT_PORT=$PORT ./target/debug/storefront-mcp.exe >/tmp/pb_try_it_sf.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf "http://localhost:$PORT/health" >/dev/null && break; sleep 0.5; done

SEED=$(./target/debug/try_it_seed.exe)
BUDGET=$(echo "$SEED" | grep '^BUDGET_PAISE=' | cut -d= -f2)
CAP=$(echo "$SEED"    | grep '^PER_TXN_CAP_PAISE=' | cut -d= -f2)
printf '\nMandate for this session: budget Rs%d, per-item cap Rs%d, whole catalog in scope.\n' \
  "$((BUDGET/100))" "$((CAP/100))"

ask() {  # <goal>
  local session
  session=$(./target/debug/try_it_seed.exe | grep '^SESSION=' | cut -d= -f2)
  echo ""
  echo "=================================================================="
  STOREFRONT_URL="http://localhost:$PORT" "$CONDA" run -n paybound \
    python -m services.agent.demo "$session" "$1"
}

if [ $# -gt 0 ]; then
  ask "$1"
else
  echo "Type a purchase request (or 'quit' to stop). Each one is a fresh session."
  while true; do
    printf '\nyou> '
    IFS= read -r goal || break
    [ -z "$goal" ] && continue
    [ "$goal" = "quit" ] && break
    ask "$goal"
  done
fi
