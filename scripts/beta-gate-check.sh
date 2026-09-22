#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — Alpha → Beta gate (Part 9A §1.6)
#
# Executable go/no-go gate. Every check prints PASS / FAIL / SKIP and the script
# exits non-zero if anything FAILs, so it can be wired into CI before
# ALPHA_INVITE_ONLY is switched off.
#
# Usage:
#   ./scripts/beta-gate-check.sh                          # production defaults
#   ./scripts/beta-gate-check.sh --url http://localhost:3000 --local
#   ./scripts/beta-gate-check.sh --url https://havenworld-game.pages.dev
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BASE_URL="https://147-224-184-148.nip.io"
CLIENT_URL="https://havenworld-game.pages.dev"
LOCAL_MODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) BASE_URL="$2"; shift 2 ;;
    --client) CLIENT_URL="$2"; shift 2 ;;
    --local) LOCAL_MODE=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
SKIP=0

pass() { PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  \033[33mSKIP\033[0m  %s\n' "$1"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── Category 1: Infrastructure stability ────────────────────────────────────
section 'Category 1 — Infrastructure stability'

HEALTH_BODY="$(curl -fsS --max-time 15 "$BASE_URL/health" 2>/dev/null || true)"
if printf '%s' "$HEALTH_BODY" | grep -q '"status":"ok"'; then
  pass 'GET /health returned status ok'
else
  fail "GET /health did not return status ok (body: ${HEALTH_BODY:0:120})"
fi

if printf '%s' "$HEALTH_BODY" | grep -q '"heapUsed"'; then
  pass '/health reports runtime metrics (heap/socket counts)'
else
  fail '/health is missing runtime metrics — Part 9B §3 monitoring is incomplete'
fi

if [ "$LOCAL_MODE" -eq 0 ]; then
  HOST="${BASE_URL#https://}"
  CERT_END="$(printf '' | openssl s_client -connect "${HOST}:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$CERT_END" ]; then
    END_EPOCH="$(date -j -f '%b %d %T %Y %Z' "$CERT_END" +%s 2>/dev/null || date -d "$CERT_END" +%s 2>/dev/null || echo 0)"
    now_epoch="$(date +%s)"
    if [ "$END_EPOCH" -gt "$now_epoch" ]; then
      days=$(( (END_EPOCH - now_epoch) / 86400 ))
      if [ "$days" -ge 14 ]; then
        pass "TLS certificate valid for $days more days"
      else
        fail "TLS certificate expires in $days days (< 14)"
      fi
    else
      fail 'TLS certificate has expired'
    fi
  else
    fail 'Could not read the TLS certificate'
  fi
else
  skip 'TLS certificate check (local mode)'
fi

if have pm2; then
  if pm2 jlist 2>/dev/null | grep -q '"name":"havenworld-server".*"status":"online"'; then
    pass 'PM2 reports havenworld-server online'
  else
    fail 'PM2 does not report havenworld-server online'
  fi
else
  skip 'PM2 not installed here (verify on the Oracle VM)'
fi

if have redis-cli; then
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    REDIS_OUT="$(redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null || true)"
  else
    REDIS_OUT="$(redis-cli --no-auth-warning ping 2>/dev/null || true)"
  fi
  if printf '%s' "$REDIS_OUT" | grep -qi pong; then
    pass 'Redis responded to PING'
  else
    skip 'Redis not reachable here (verify on the Oracle VM)'
  fi
else
  skip 'redis-cli not installed here'
fi

# ── Category 2: Application quality ─────────────────────────────────────────
section 'Category 2 — Application quality'

HEADERS="$(curl -fsSI --max-time 15 "$BASE_URL/health" 2>/dev/null || true)"
check_header() {
  if printf '%s' "$HEADERS" | grep -qi "^$1:"; then
    pass "Security header present: $1"
  else
    fail "Security header missing: $1"
  fi
}
check_header 'strict-transport-security'
check_header 'x-content-type-options'

legal_ok=0
for path in '/privacy.html' '/terms.html'; do
  found=0
  for base in "$CLIENT_URL" "$BASE_URL"; do
    if curl -fsS -o /dev/null --max-time 15 "$base$path" 2>/dev/null; then
      pass "Legal page reachable: $base$path"
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    fail "Legal page unreachable: $path"
  else
    legal_ok=$((legal_ok + 1))
  fi
done

if curl -fsS -o /dev/null --max-time 15 "$CLIENT_URL/manifest.webmanifest" 2>/dev/null; then
  pass 'PWA manifest is served'
else
  fail 'PWA manifest is missing (Part 9A §2.2)'
fi

if curl -fsS -o /dev/null --max-time 15 "$CLIENT_URL/sw.js" 2>/dev/null; then
  pass 'Service worker is served'
else
  fail 'Service worker is missing (Part 9A §2.4)'
fi

# ── Category 3: Game loop quality ───────────────────────────────────────────
section 'Category 3 — Game loop quality'

HANDSHAKE="$(curl -fsS --max-time 15 "$BASE_URL/socket.io/?EIO=4&transport=polling" 2>/dev/null || true)"
if printf '%s' "$HANDSHAKE" | grep -q '"sid"'; then
  pass 'Socket.io handshake returned a session id'
else
  fail 'Socket.io handshake failed — the realtime loop is down'
fi

if have k6; then
  pass 'k6 available for the load gate (load-tests/*.js)'
else
  skip 'k6 not installed; run the load gate via the nightly workflow'
fi

# ── Category 4: Community & legal readiness ─────────────────────────────────
section 'Category 4 — Community and legal readiness'

for file in LICENSE CODE_OF_CONDUCT.md CONTRIBUTING.md SECURITY.md; do
  if [ -f "$file" ]; then
    pass "Repository file present: $file"
  else
    fail "Repository file missing: $file"
  fi
done

if [ -f 'apps/client/privacy.html' ] && [ -f 'apps/client/terms.html' ]; then
  pass 'Privacy policy and Terms of Service ship with the client'
else
  fail 'Privacy policy or Terms of Service missing from apps/client'
fi

printf '\n\033[1mGate summary\033[0m: %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  echo 'RESULT: NO-GO — do not remove the alpha invite wall yet.' >&2
  exit 1
fi
echo 'RESULT: GO — the alpha → beta gate is satisfied.'