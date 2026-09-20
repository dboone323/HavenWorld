#!/usr/bin/env bash
# /opt/havenworld/scripts/run-load-tests.sh
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — k6 load test runner (Oracle VM)
# Replaces .github/workflows/load-test.yml for free-tier local execution.
#
# Usage (on Oracle):    bash scripts/run-load-tests.sh
# Usage (via make):     make load-test
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/havenworld"
RESULTS_DIR="$APP_DIR/load-test-results"
DATE=$(date +%Y%m%d-%H%M)

mkdir -p "$RESULTS_DIR"
cd "$APP_DIR"

ok=0
fail=0

run_test() {
  local label="$1"
  local script="$2"
  local extra="${3:-}"

  echo ""
  echo "==> Running: $label"
  # shellcheck disable=SC2086
  if k6 run $extra \
      --out "json=${RESULTS_DIR}/${label}-${DATE}.json" \
      "load-tests/${script}" 2>&1; then
    ok=$((ok + 1))
    echo "    PASS: $label"
  else
    fail=$((fail + 1))
    echo "    FAIL: $label (check ${RESULTS_DIR}/${label}-${DATE}.json)"
  fi
}

run_test "ws-concurrent"      "load-tests/ws-concurrent.js"
run_test "api-auth"           "load-tests/api-auth.js"        "-e BASE_URL=http://localhost:3000"
run_test "fishing-concurrent" "load-tests/fishing-concurrent.js"

echo ""
echo "Load test summary: ${ok} passed, ${fail} failed"
echo "Results in: $RESULTS_DIR"

# Prune results older than 30 days
find "$RESULTS_DIR" -name "*.json" -mtime +30 -delete

if [ "$fail" -gt 0 ]; then
  exit 1
fi
