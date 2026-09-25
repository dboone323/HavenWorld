#!/usr/bin/env bash
# hw_probe_nodemon.sh — isolate why POST /api/auth/register hangs under the exact
# command Playwright's webServer uses (nodemon dev) versus a plain tsx start.
# Local test database only.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/logs/local/recovery"
mkdir -p "$STATE"
cd "$ROOT"

TEST_URL="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"
COMMON_ENV="NODE_ENV=test SERVER_AUTOSTART=true ALPHA_INVITE_ONLY=false DATABASE_URL=$TEST_URL REDIS_URL=redis://127.0.0.1:6379/1"

wait_health() { # $1 port
  for _ in $(seq 1 60); do sleep 1; curl -sf --max-time 2 "http://localhost:$1/health" >/dev/null 2>&1 && return 0; done
  return 1
}

probe_register() { # $1 port
  local u="nodeprobe_$RANDOM"
  echo "  -> POST /api/auth/register (max-time 20s)"
  curl -s -o "$STATE/np.json" -w '  status=%{http_code} total_time=%{time_total}\n' --max-time 20 \
    -X POST "http://localhost:$1/api/auth/register" \
    -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
    -d "{\"username\":\"$u\",\"email\":\"$u@havenworld.test\",\"password\":\"ProbePass123\"}" || echo "  curl exited $? (timeout or connection reset)"
  head -c 160 "$STATE/np.json" 2>/dev/null; echo
}

echo "=== PHASE A: exactly what Playwright starts (pnpm --filter server dev = nodemon) ==="
env $COMMON_ENV PORT=3000 nohup pnpm --filter server dev > "$STATE/np_nodemon.log" 2>&1 &
if wait_health 3000; then echo "  health OK on 3000"; else echo "  health FAILED"; tail -15 "$STATE/np_nodemon.log"; fi
probe_register 3000
echo "  --- nodemon log tail ---"
tail -12 "$STATE/np_nodemon.log"
pkill -f 'nodemon' >/dev/null 2>&1; pkill -f 'ts-node src/index.ts' >/dev/null 2>&1; sleep 2

echo
echo "=== PHASE B: plain tsx start on 3225 (same env) ==="
cd apps/server
env NODE_ENV=test SERVER_AUTOSTART=true ALPHA_INVITE_ONLY=false PORT=3225 DATABASE_URL="$TEST_URL" \
  REDIS_URL="redis://127.0.0.1:6379/1" nohup pnpm exec tsx src/index.ts > "$STATE/np_tsx.log" 2>&1 &
if wait_health 3225; then echo "  health OK on 3225"; else echo "  health FAILED"; tail -15 "$STATE/np_tsx.log"; fi
probe_register 3225
pkill -f 'tsx src/index.ts' >/dev/null 2>&1
sleep 1
echo
echo "=== DONE (servers stopped) ==="
