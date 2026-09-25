#!/usr/bin/env bash
# hw_step5.sh — deploy the auth fix, then prove register -> login -> authenticated request end to end.
set -uo pipefail
AS="sudo -n -u havenworld -H"
cd /opt/havenworld && git pull --ff-only origin main 2>&1 | tail -3
cd /opt/havenworld/apps/server
DB=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d '"')

echo "=== 0. CLEAN UP PREVIOUS SMOKE DATA ==="
psql "$DB" -t -A -c "DELETE FROM room_furniture WHERE \"placedBy\" IN (SELECT id FROM users WHERE username LIKE 'smoke_%');" 
psql "$DB" -t -A -c "DELETE FROM users WHERE username LIKE 'smoke_%';"
psql "$DB" -t -A -c "DELETE FROM rooms WHERE \"ownerId\" IS NULL;"
psql "$DB" -t -A -c "DELETE FROM refresh_tokens;"
printf 'users left: '; psql "$DB" -t -A -c "SELECT count(*) FROM users;"

echo "=== 1. REBUILD + RELOAD ==="
$AS bash -lc "cd /opt/havenworld && pnpm --filter '@havenworld/shared' build 2>&1 | tail -2"
$AS bash -lc "cd /opt/havenworld/apps/server && pnpm exec prisma generate 2>&1 | tail -1"
$AS bash -lc "cd /opt/havenworld/apps/server && pnpm exec tsc 2>&1 | tail -3"
$AS pm2 reload havenworld-server --update-env 2>&1 | tail -2
sleep 7
curl -s -m 5 -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:3000/health

U="smoke_$(date +%s)"
P="SmokeTest123"
echo "=== 2. REGISTER $U ==="
curl -s -m 20 -X POST http://127.0.0.1:3000/api/auth/register -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"email\":\"$U@example.com\",\"password\":\"$P\"}" -o /opt/havenworld/tmp/reg.json -w "http=%{http_code}\n"
cat /opt/havenworld/tmp/reg.json; echo

echo "=== 3. LOGIN BY USERNAME ==="
curl -s -m 20 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"$P\"}" -c /opt/havenworld/tmp/cj.txt -o /opt/havenworld/tmp/login.json -w "http=%{http_code}\n"
python3 -c "
import json
d=json.load(open('/opt/havenworld/tmp/login.json'))
print('keys:', sorted(d.keys()))
print('accessToken chars:', len(d.get('accessToken','')))
print('user:', json.dumps(d.get('user'))[:280])
" 2>/dev/null || head -c 400 /opt/havenworld/tmp/login.json
echo

echo "=== 4. LOGIN BY EMAIL ==="
curl -s -m 20 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$U@example.com\",\"password\":\"$P\"}" -o /dev/null -w "http=%{http_code}\n"

echo "=== 5. AUTHENTICATED REQUESTS ==="
TOKEN=$(python3 -c "import json;print(json.load(open('/opt/havenworld/tmp/login.json')).get('accessToken',''))" 2>/dev/null)
curl -s -m 15 http://127.0.0.1:3000/api/users/me -H "Authorization: Bearer $TOKEN" -o /opt/havenworld/tmp/me.json -w "GET /api/users/me = %{http_code}\n"
head -c 300 /opt/havenworld/tmp/me.json; echo
curl -s -m 15 http://127.0.0.1:3000/api/users/me/inventory -H "Authorization: Bearer $TOKEN" -o /dev/null -w "GET /api/users/me/inventory = %{http_code}\n"
curl -s -m 15 http://127.0.0.1:3000/api/rooms -H "Authorization: Bearer $TOKEN" -o /dev/null -w "GET /api/rooms = %{http_code}\n"

echo "=== 6. REFRESH ROTATION (cookie) ==="
curl -s -m 15 -X POST http://127.0.0.1:3000/api/auth/refresh -b /opt/havenworld/tmp/cj.txt -c /opt/havenworld/tmp/cj.txt -o /opt/havenworld/tmp/refresh.json -w "refresh=%{http_code}\n"
head -c 200 /opt/havenworld/tmp/refresh.json; echo

echo "=== 7. DATA CREATED FOR THE SMOKE USER (avatar + loft + inventory) ==="
psql "$DB" -t -A -c "SELECT 'user: ' || username || ' verified=' || \"emailVerified\" || ' role=' || role || ' coins=' || \"havenCoins\" FROM users WHERE username='$U';"
psql "$DB" -t -A -c "SELECT 'avatar rows: ' || count(*) FROM avatars a JOIN users u ON u.id = a.\"userId\" WHERE u.username='$U';"
psql "$DB" -t -A -c "SELECT 'rooms: ' || count(*) FROM rooms r JOIN users u ON u.id = r.\"ownerId\" WHERE u.username='$U';"
psql "$DB" -t -A -c "SELECT 'inventory items: ' || count(*) FROM inventories i JOIN users u ON u.id = i.\"userId\" WHERE u.username='$U';"
psql "$DB" -t -A -c "SELECT 'refresh tokens: ' || count(*) FROM refresh_tokens;"
psql "$DB" -t -A -c "SELECT 'login events: ' || count(*) FROM game_events WHERE event='LOGIN';"

echo "=== 8. CLEAN UP SMOKE DATA ==="
psql "$DB" -t -A -c "DELETE FROM room_furniture WHERE \"placedBy\" IN (SELECT id FROM users WHERE username='$U');"
psql "$DB" -t -A -c "DELETE FROM users WHERE username='$U';"
psql "$DB" -t -A -c "DELETE FROM rooms WHERE \"ownerId\" IS NULL;"
psql "$DB" -t -A -c "DELETE FROM refresh_tokens;"
printf 'users left: '; psql "$DB" -t -A -c "SELECT count(*) FROM users;"
printf 'rooms left: '; psql "$DB" -t -A -c "SELECT count(*) FROM rooms;"

echo "=== 9. SEEDED REFERENCE DATA ==="
psql "$DB" -t -A -c "SELECT 'items: ' || count(*) FROM items;"
psql "$DB" -t -A -c "SELECT 'rooms: ' || count(*) FROM rooms;"
psql "$DB" -t -A -c "SELECT 'public rooms: ' || string_agg(name, ', ') FROM rooms WHERE \"isPublic\";"

echo "=== DONE ==="
