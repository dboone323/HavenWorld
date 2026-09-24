#!/usr/bin/env bash
# hw_step3.sh — clear the failed migration, apply corrected history, close all drift.
set -uo pipefail
cd /opt/havenworld/apps/server
DB=$(grep -m1 "^DATABASE_URL=" .env | cut -d= -f2- | tr -d '"')

echo "=== 1. PULL CORRECTED MIGRATION FROM ORIGIN ==="
cd /opt/havenworld && git pull --ff-only origin main 2>&1 | tail -4
cd /opt/havenworld/apps/server
grep -c "crafting_queues" prisma/migrations/20260919000000_add_analytics_tutorial_craft_notifications/migration.sql || echo "  OK: crafting_queues reference removed"

echo "=== 2. CLEAR FAILED MIGRATION STATE ==="
pnpm exec prisma migrate resolve --rolled-back 20260919000000_add_analytics_tutorial_craft_notifications 2>&1 | tail -4

echo "=== 3. DROP THE MIS-GENERATED MIGRATION FOLDER (never applied) ==="
rm -rf prisma/migrations/20260923160936_complete_game_schema /tmp/hw_step2.out
ls prisma/migrations

echo "=== 4. MIGRATE DEPLOY (init + repaired 000000 + gender) ==="
pnpm exec prisma migrate deploy 2>&1 | tail -10
printf 'tables now: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"

echo "=== 5. GENERATE COMPLETE-SCHEMA MIGRATION FROM REAL DRIFT ==="
DIR="prisma/migrations/20260923170000_complete_game_schema"
mkdir -p "$DIR"
pnpm exec prisma migrate diff --from-url "$DB" --to-schema-datamodel prisma/schema.prisma --script > "$DIR/migration.sql" 2>/tmp/diff.err || cat /tmp/diff.err
echo "generated lines: $(wc -l < "$DIR/migration.sql")"
grep -c 'CREATE TABLE' "$DIR/migration.sql" || true
head -6 "$DIR/migration.sql"

echo "=== 6. APPLY COMPLETE-SCHEMA MIGRATION ==="
pnpm exec prisma migrate deploy 2>&1 | tail -10

echo "=== 7. FINAL STATE ==="
printf 'public tables: '; psql "$DB" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
psql "$DB" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;" | tr '\n' ' '; echo
echo "--- crafting_queues has notifiedAt? ---"
psql "$DB" -t -A -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='crafting_queues' ORDER BY ordinal_position;" | tr '\n' ' '; echo

echo "=== 8. FINAL DRIFT CHECK (must be empty) ==="
pnpm exec prisma migrate diff --from-url "$DB" --to-schema-datamodel prisma/schema.prisma --script 2>&1 | tail -4

echo "=== 9. MIGRATE STATUS ==="
pnpm exec prisma migrate status 2>&1 | tail -8

echo "=== 10. LEDGER (must show real steps, not 0) ==="
psql "$DB" -t -A -c "SELECT migration_name || ' steps=' || applied_steps_count FROM _prisma_migrations ORDER BY migration_name;" | tr '\n' ' '; echo

echo "=== DONE ==="
