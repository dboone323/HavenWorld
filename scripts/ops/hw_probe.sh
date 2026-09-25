#!/usr/bin/env bash
# hw_probe.sh — boot the API locally against the LOCAL test database and probe the
# exact HTTP status of the E2E helper routes. Local databases only; no production target.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/logs/local/recovery"
mkdir -p "$STATE"
cd "$ROOT/apps/server"

TEST_URL="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"
DEV_URL="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_dev"

start_server() { # $1 = port, $2 = db url, $3 = log
  NODE_ENV=test SERVER_AUTOSTART=true PORT="$1" DATABASE_URL="$2" \
    REDIS_URL="redis://127.0.0.1:6379/1" nohup pnpm exec tsx src/index.ts > "$3" 2>&1 &
  for _ in $(seq 1 60); do
    sleep 1
    curl -sf --max-time 2 "http://localhost:$1/health" >/dev/null 2>&1 && return 0
  done
  return 1
}

stop_servers() { pkill -f 'tsx src/index.ts' >/dev/null 2>&1; sleep 1; }

A="http://localhost:3222"
echo "=== PHASE 1: local *test* database, port 3222 ==="
if ! start_server 3222 "$TEST_URL" "$STATE"/hw_probe1.log; then
  echo "SERVER FAILED TO START"; tail -20 "$STATE"/hw_probe1.log; exit 1
fi
echo "server up."
curl -s --max-time 5 "$A/health"; echo

U="e2eprobe_$RANDOM"
echo
echo "=== POST /api/auth/register (${U}@havenworld.test) ==="
curl -s -o "$STATE"/pr1.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"email\":\"$U@havenworld.test\",\"password\":\"ProbePass123\"}"
head -c 300 "$STATE"/pr1.json; echo

echo
echo "=== POST /api/test/verify-email ==="
curl -s -o "$STATE"/pr2.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/test/verify-email" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$U@havenworld.test\"}"
head -c 300 "$STATE"/pr2.json; echo

echo
echo "=== POST /api/auth/login ==="
curl -s -o "$STATE"/pr3.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"ProbePass123\"}"
head -c 200 "$STATE"/pr3.json; echo

echo
echo "=== POST /api/test/reset (should be 200 on a *_test db) ==="
curl -s -o "$STATE"/pr4.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/test/reset"
head -c 300 "$STATE"/pr4.json; echo

stop_servers
echo
echo "=== PHASE 2: local *dev* database (no \"_test\"), port 3223 — guard must reject ==="
if ! start_server 3223 "$DEV_URL" "$STATE"/hw_probe2.log; then
  echo "SERVER FAILED TO START"; tail -20 "$STATE"/hw_probe2.log; exit 1
fi
echo "server up."
curl -s -o "$STATE"/pr5.json -w 'status=%{http_code}\n' --max-time 10 -X POST "http://localhost:3223/api/test/reset"
head -c 300 "$STATE"/pr5.json; echo

stop_servers
echo
echo "=== DONE (servers stopped) ==="
