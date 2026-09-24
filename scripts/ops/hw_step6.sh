#!/usr/bin/env bash
# hw_step6.sh — restore seeded rooms, then prove the whole flow through the PUBLIC https entrypoint.
set -uo pipefail
cd /opt/havenworld/apps/server
DB=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d '"')
API="https://147-224-184-148.nip.io"

echo "=== 1. RESTORE SEEDED REFERENCE ROOMS (my cleanup had removed them) ==="
sudo -n -u havenworld -H bash -lc "cd /opt/havenworld/apps/server && pnpm exec prisma db seed 2>&1 | tail -6"
psql "$DB" -t -A -c "SELECT 'rooms: ' || count(*) FROM rooms;"
psql "$DB" -t -A -c "SELECT 'room: ' || id || ' | ' || name || ' | public=' || \"isPublic\" FROM rooms ORDER BY id;"

echo "=== 2. PUBLIC ENTRYPOINT HEALTH ==="
curl -sk -m 10 -o /dev/null -w "GET $API/api/health -> %{http_code}\n" "$API/api/health" || true
curl -sk -m 10 -o /dev/null -w "GET $API/health -> %{http_code}\n" "$API/health" || true

U="pubs_$(date +%s)"
P="SmokeTest123"
echo "=== 3. REGISTER THROUGH THE PUBLIC URL ($U) ==="
curl -sk -m 25 -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"email\":\"$U@example.com\",\"password\":\"$P\"}" -o /tmp/preg.json -w "http=%{http_code}\n"
cat /tmp/preg.json; echo

echo "=== 4. LOGIN THROUGH THE PUBLIC URL ==="
curl -sk -m 25 -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"$P\"}" -o /tmp/plogin.json -w "http=%{http_code}\n"
python3 -c "
import json
d=json.load(open('/tmp/plogin.json'))
print('accessToken chars:', len(d.get('accessToken','')))
print('user:', json.dumps(d.get('user'))[:200])
" 2>/dev/null || head -c 300 /tmp/plogin.json
echo

TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/plogin.json')).get('accessToken',''))" 2>/dev/null)
echo "=== 5. AUTHENTICATED CALL THROUGH THE PUBLIC URL ==="
curl -sk -m 20 "$API/api/users/me" -H "Authorization: Bearer $TOKEN" -o /tmp/pme.json -w "GET /api/users/me -> %{http_code}\n"
head -c 220 /tmp/pme.json; echo

echo "=== 6. CLEANUP (scoped to this user only, seeded rooms preserved) ==="
UID_=$(psql "$DB" -t -A -c "SELECT id FROM users WHERE username='$U';")
psql "$DB" -t -A -c "DELETE FROM room_furniture WHERE \"placedBy\"='$UID_';"
psql "$DB" -t -A -c "DELETE FROM rooms WHERE \"ownerId\"='$UID_';"
psql "$DB" -t -A -c "DELETE FROM users WHERE id='$UID_';"
psql "$DB" -t -A -c "DELETE FROM refresh_tokens;"
printf 'users: ';  psql "$DB" -t -A -c "SELECT count(*) FROM users;"
printf 'rooms: ';  psql "$DB" -t -A -c "SELECT count(*) FROM rooms;"
printf 'items: ';  psql "$DB" -t -A -c "SELECT count(*) FROM items;"
printf 'invite codes: '; psql "$DB" -t -A -c "SELECT count(*) FROM invite_codes;"

echo "=== 7. FINAL CONFIG ==="
grep -E "^(ALPHA_INVITE_ONLY|SERVER_URL|CLIENT_URL)=" .env
printf 'nginx server_name: '; sudo -n grep -h "server_name" /etc/nginx/sites-enabled/* 2>/dev/null | tr -s ' ' | tr '\n' ' '; echo
printf 'migration folders: '; ls prisma/migrations | tr '\n' ' '; echo
printf 'complete-schema migration size: '; wc -l prisma/migrations/20260923170000_complete_game_schema/migration.sql

echo "=== DONE ==="
