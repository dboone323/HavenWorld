set -e
cd /opt/havenworld/apps/server
DB=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d '"')

BACKUP_DIR="/opt/havenworld/backups"
mkdir -p "$BACKUP_DIR"
echo "=== 1. SQL BACKUP (pg_dump 17) ==="
pg_dump --no-owner --no-privileges --file="$BACKUP_DIR/legacy_backup.sql" "$DB"
gzip -f "$BACKUP_DIR/legacy_backup.sql"
ls -la "$BACKUP_DIR/legacy_backup.sql.gz"
printf 'CREATE TABLE count in dump: '; zcat "$BACKUP_DIR/legacy_backup.sql.gz" | grep -c '^CREATE TABLE' || true

echo "=== 2. pre-check: existing enum types ==="
psql "$DB" -t -A -c "SELECT typname FROM pg_type WHERE typtype='e' AND typnamespace='public'::regnamespace ORDER BY 1;" || true

echo "=== 3. PARK LEGACY TABLES ==="
for t in profiles avatar_profiles rooms messages user_friends user_inventory placed_furniture; do
  psql "$DB" -q -v ON_ERROR_STOP=1 -c "ALTER TABLE \"$t\" RENAME TO \"legacy_$t\";" && echo "  parked: legacy_$t"
done
psql "$DB" -q -v ON_ERROR_STOP=1 -c "ALTER TABLE \"_prisma_migrations\" RENAME TO \"legacy__prisma_migrations\";" && echo "  parked: legacy__prisma_migrations"

echo "=== 4. MIGRATE DEPLOY ==="
pnpm exec prisma migrate deploy 2>&1 | tail -10

echo "=== 5. TABLE COUNT NOW ==="
psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
psql "$DB" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;" | tr '\n' ' '

echo
echo "=== 6. ALPHA FLAG / ENV ==="
grep -E "^(ALPHA_INVITE_ONLY|NODE_ENV|PORT)=" .env || echo '(no ALPHA_INVITE_ONLY set)'
