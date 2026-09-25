#!/usr/bin/env bash
# hw_auth_recover.sh — READ ONLY. Locate the owner's old login credential so it can
# be migrated into public.users. Prints counts, prefixes and player handles only:
# never a password hash, never a full email, never DATABASE_URL.
set -uo pipefail
cd /opt/havenworld/apps/server
DB=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
DUMP=/opt/havenworld/tmp/legacy_backup.sql.gz

echo "=== A. which tables in the dump actually carry DATA ==="
gunzip -c "$DUMP" | grep '^COPY ' | sed 's/ FROM stdin;//' | tr '\n' ' '
echo
printf 'dump lines: '; gunzip -c "$DUMP" | wc -l

echo "=== B. auth.users COPY header (column names only) ==="
gunzip -c "$DUMP" | grep -m1 '^COPY auth.users' || echo "(no auth.users COPY block)"

echo "=== C. auth.users rows present in the dump ==="
printf 'data lines: '; gunzip -c "$DUMP" | sed -n '/^COPY auth.users /,/^\\\.$/p' | wc -l

echo "=== D. live legacy_profiles credential coverage ==="
psql "$DB" -t -A -c "SELECT 'profiles: '||count(*)||' | with_password_hash: '||count(password_hash)||' | linked_to_auth_user_id: '||count(auth_user_id) FROM legacy.legacy_profiles;"
psql "$DB" -t -A -c "SELECT 'hash prefix '||left(password_hash,4)||' -> '||count(*)||' rows' FROM legacy.legacy_profiles WHERE password_hash IS NOT NULL GROUP BY 1;"

echo "=== E. 15 oldest profiles (own handles only) ==="
psql "$DB" -t -A -F ' | ' -c "SELECT username, created_at::date, (password_hash IS NOT NULL) AS has_pw FROM legacy.legacy_profiles ORDER BY created_at NULLS LAST, username LIMIT 15;"

echo "=== F. owner-looking handles ==="
psql "$DB" -t -A -F ' | ' -c "SELECT username, created_at::date, (password_hash IS NOT NULL) AS has_pw FROM legacy.legacy_profiles WHERE username ILIKE '%daniel%' OR username ILIKE '%dboone%' OR username ILIKE '%admin%' OR username ILIKE '%owner%' OR username ILIKE '%haven%' ORDER BY created_at NULLS LAST LIMIT 20;"

echo "=== G. what would be restorable for a recovered account ==="
psql "$DB" -t -A -c "SELECT 'avatars: '||count(*) FROM legacy.legacy_avatar_profiles;"
psql "$DB" -t -A -c "SELECT 'rooms: '||count(*) FROM legacy.legacy_rooms;"
psql "$DB" -t -A -c "SELECT 'furniture: '||count(*) FROM legacy.legacy_placed_furniture;"
psql "$DB" -t -A -c "SELECT 'inventory: '||count(*) FROM legacy.legacy_user_inventory;"
psql "$DB" -t -A -c "SELECT 'friends: '||count(*) FROM legacy.legacy_user_friends;"

echo "=== H. current public.users (should be empty) ==="
psql "$DB" -t -A -c "SELECT 'users: '||count(*) FROM public.users;"
psql "$DB" -t -A -c "SELECT 'constraints on users: '||string_agg(conname||'('||pg_get_constraintdef(oid)||')', ', ') FROM pg_constraint WHERE conrelid='public.users'::regclass;"

echo "=== DONE (nothing was modified) ==="
