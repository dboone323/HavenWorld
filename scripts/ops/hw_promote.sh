#!/usr/bin/env bash
# hw_promote.sh — promote the single registered account to ADMIN and report state.
# Prints no email address (masked) and no secrets.
set -uo pipefail
cd /opt/havenworld/apps/server
DB=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
USERNAME=${1:-dboone323}

EMAIL=$(psql "$DB" -t -A -c "SELECT email FROM users WHERE username='$USERNAME'")
if [ -z "$EMAIL" ]; then
  echo "ERROR: no account found for username '$USERNAME'"
  psql "$DB" -t -A -c "SELECT 'users in table: '||count(*) FROM users;"
  exit 1
fi

echo "=== before ==="
psql "$DB" -t -A -F ' | ' -c "SELECT username, role, \"emailVerified\" FROM users WHERE username='$USERNAME';"

echo "=== promote (output email-masked) ==="
sudo -n -u havenworld -H bash -lc "cd /opt/havenworld/apps/server && pnpm exec tsx src/scripts/promote-admin.ts '$EMAIL'" 2>&1 \
  | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/[email-masked]/g'

echo "=== after ==="
psql "$DB" -t -A -F ' | ' -c "SELECT username, role, \"emailVerified\", \"emailVerifyToken\" IS NULL AS token_cleared FROM users WHERE username='$USERNAME';"

echo "=== account footprint ==="
psql "$DB" -t -A -c "SELECT 'avatars: '||count(*) FROM avatars;"
psql "$DB" -t -A -c "SELECT 'inventory rows: '||count(*) FROM inventories;"
psql "$DB" -t -A -c "SELECT 'rooms owned: '||count(*) FROM rooms WHERE \"ownerId\"=(SELECT id FROM users WHERE username='$USERNAME');"
psql "$DB" -t -A -c "SELECT 'invite codes: '||count(*) FROM invite_codes;"

echo "=== DONE ==="
