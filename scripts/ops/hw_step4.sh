#!/usr/bin/env bash
# hw_step4.sh — seed reference data, build, reload, and smoke-test register + login end to end.
set -uo pipefail
AS="sudo -n -u havenworld -H"
cd /opt/havenworld/apps/server
DB=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d '"')

echo "=== 1. BUILD SHARED + SERVER as havenworld ==="
$AS bash -lc "cd /opt/havenworld && pnpm --filter '@havenworld/shared' build 2>&1 | tail -3"
$AS bash -lc "cd /opt/havenworld/apps/server && pnpm exec prisma generate 2>&1 | tail -2 && pnpm exec tsc 2>&1 | tail -5"; echo "tsc_exit=$?"
ls -la dist/index.js

echo "=== 2. SEED (reference rooms + items) ==="
$AS bash -lc "cd /opt/havenworld/apps/server && pnpm exec prisma db seed 2>&1 | tail -12"

echo "=== 3. RELOAD PM2 ==="
$AS pm2 reload havenworld-server --update-env 2>&1 | tail -3
sleep 6
curl -s -m 5 -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:3000/health

echo "=== 4. TEMPORARILY ALLOW OPEN REGISTRATION FOR SMOKE TEST ==="
sudo -n sed -i 's/^ALPHA_INVITE_ONLY=true/ALPHA_INVITE_ONLY=false/' .env
grep -E '^ALPHA_INVITE_ONLY=' .env
$AS pm2 reload havenworld-server --update-env 2>&1 | tail -1
sleep 6

U="smoke_$(date +%s)"
P="SmokeTest123"
echo "=== 5. REGISTER $U ==="
curl -s -m 15 -X POST http://127.0.0.1:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"email\":\"$U@example.com\",\"password\":\"$P\"}" \
  -o /tmp/reg.json -w "http=%{http_code}\n"
head -c 600 /tmp/reg.json; echo

echo "=== 6. LOGIN BY USERNAME ==="
curl -s -m 15 -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"$P\"}" \
  -o /tmp/login.json -w "http=%{http_code}\n"
python3 -c "import json;d=json.load(open('/tmp/login.json'));print('keys:',sorted(d.keys()));print('accessToken len:',len(d.get('accessToken') or d.get('access_token') or ''));print('user:',json.dumps(d.get('user'),)[:300])" 2>/dev/null || head -c 600 /tmp/login.json
echo

echo "=== 7. LOGIN BY EMAIL + AUTHENTICATED CALL ==="
TOKEN=$(python3 -c "import json;d=json.load(open('/tmp/login.json'));print(d.get('accessToken') or d.get('access_token') or '')" 2>/dev/null)
curl -s -m 15 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$U@example.com\",\"password\":\"$P\"}" -o /dev/null -w "login_by_email=%{http_code}\n"
curl -s -m 15 http://127.0.0.1:3000/api/auth/me -H "Authorization: Bearer $TOKEN" -o /tmp/me.json -w "me=%{http_code}\n"
head -c 400 /tmp/me.json; echo

echo "=== 8. DB ROWS CREATED BY THE SMOKE USER ==="
psql "$DB" -t -A -c "SELECT username || ' | role=' || role || ' | coins=' || \"havenCoins\" || ' | hash=' || left(\"passwordHash\",7) FROM users WHERE username LIKE 'smoke_%' OR username = '$U';"

echo "=== DONE ==="
