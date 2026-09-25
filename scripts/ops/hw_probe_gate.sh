#!/usr/bin/env bash
# hw_probe_gate.sh — probe the local API with the alpha gate OFF to isolate
# "gate blocks registration" from "UI/spec drift blocks registration". Local DB only.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/logs/local/recovery"
mkdir -p "$STATE"
cd "$ROOT/apps/server"
TEST_URL="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"
A="http://localhost:3224"
U="gateprobe_$RANDOM"

NODE_ENV=test SERVER_AUTOSTART=true ALPHA_INVITE_ONLY=false PORT=3224 DATABASE_URL="$TEST_URL" \
  REDIS_URL="redis://127.0.0.1:6379/1" nohup pnpm exec tsx src/index.ts > "$STATE"/hw_gate.log 2>&1 &
for _ in $(seq 1 60); do sleep 1; curl -sf --max-time 2 "$A/health" >/dev/null 2>&1 && break; done

echo "=== register with gate OFF (ALPHA_INVITE_ONLY=false) ==="
curl -s -o "$STATE"/g1.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"email\":\"$U@havenworld.test\",\"password\":\"ProbePass123\"}"
head -c 300 "$STATE"/g1.json; echo

echo "=== verify-email via test route ==="
curl -s -o "$STATE"/g2.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/test/verify-email" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$U@havenworld.test\"}"
head -c 250 "$STATE"/g2.json; echo

echo "=== login ==="
curl -s -o "$STATE"/g3.json -w 'status=%{http_code}\n' --max-time 10 -X POST "$A/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"ProbePass123\"}"
head -c 200 "$STATE"/g3.json; echo

echo "=== cleanup probe account ==="
curl -s -o /dev/null -w 'cleanup_status=%{http_code}\n' --max-time 10 -X POST "$A/api/test/cleanup" \
  -H 'Content-Type: application/json' -d "{\"emails\":[\"$U@havenworld.test\"]}"

pkill -f 'tsx src/index.ts' >/dev/null 2>&1
sleep 1
echo "=== DONE (server stopped) ==="
