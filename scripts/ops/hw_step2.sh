#!/usr/bin/env bash
# hw_step2.sh — move legacy tables out of public, apply real migrations, close drift.
set -uo pipefail
cd /opt/havenworld/apps/server
DB=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d '"')

echo "=== 0. CURRENT STATE ==="
printf 'schemas: '; psql "$DB" -t -A -c "SELECT string_agg(nspname, ', ') FROM pg_namespace WHERE nspname IN ('public','legacy');"
printf 'public tables: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
psql "$DB" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;" | tr '\n' ' '; echo

echo "=== 1. MOVE ALL PUBLIC TABLES INTO 'legacy' SCHEMA ==="
psql "$DB" -q -c "CREATE SCHEMA IF NOT EXISTS legacy;"
psql "$DB" -t -A -c "SELECT format('ALTER TABLE public.%I SET SCHEMA legacy;', table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" > /opt/havenworld/tmp/move.sql
cat /opt/havenworld/tmp/move.sql
if [ -s /opt/havenworld/tmp/move.sql ]; then psql "$DB" -v ON_ERROR_STOP=1 -q -f /opt/havenworld/tmp/move.sql; fi
printf 'public tables remaining: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
printf 'legacy tables: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='legacy' AND table_type='BASE TABLE';"

echo "=== 2. MIGRATE DEPLOY (the 3 real migrations) ==="
pnpm exec prisma migrate deploy 2>&1 | tail -14

echo "=== 3. TABLES AFTER DEPLOY ==="
printf 'count: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
psql "$DB" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;" | tr '\n' ' '; echo

echo "=== 4. DRIFT vs schema.prisma ==="
pnpm exec prisma migrate diff --from-url "$DB" --to-schema-datamodel prisma/schema.prisma --script > /opt/havenworld/tmp/drift.sql 2>/opt/havenworld/tmp/drift.err || cat /opt/havenworld/tmp/drift.err
LINES=$(wc -l < /opt/havenworld/tmp/drift.sql)
echo "drift lines: $LINES"
head -15 /opt/havenworld/tmp/drift.sql

if [ "$LINES" -gt 3 ]; then
  TS=$(date -u +%Y%m%d%H%M%S)
  DIR="prisma/migrations/${TS}_complete_game_schema"
  mkdir -p "$DIR"
  cp /opt/havenworld/tmp/drift.sql "$DIR/migration.sql"
  echo "=== 5. APPLY NEW MIGRATION ${TS}_complete_game_schema ==="
  pnpm exec prisma migrate deploy 2>&1 | tail -10
else
  echo "(no drift - nothing to apply)"
fi

echo "=== 6. FINAL TABLE COUNT ==="
printf 'count: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
psql "$DB" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;" | tr '\n' ' '; echo

echo "=== 7. FINAL DRIFT (expect empty) ==="
pnpm exec prisma migrate diff --from-url "$DB" --to-schema-datamodel prisma/schema.prisma --script 2>&1 | tail -3

echo "=== 8. MIGRATE STATUS ==="
pnpm exec prisma migrate status 2>&1 | tail -8

echo "=== DONE ==="
