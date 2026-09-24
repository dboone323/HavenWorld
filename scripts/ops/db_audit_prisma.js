#!/usr/bin/env node
// db_audit_prisma.js — read-only audit of the live HavenWorld DB via the app's own Prisma client.
// Run with:  cd /opt/havenworld/apps/server && node /tmp/db_audit_prisma.js
'use strict';

const fs = require('fs');
const ENV = '/opt/havenworld/apps/server/.env';

let url = process.env.DATABASE_URL;
if (!url) {
  const txt = fs.readFileSync(ENV, 'utf8');
  const m = txt.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  if (m) url = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!url) { console.error('FAIL: no DATABASE_URL'); process.exit(1); }

const { PrismaClient } = require('/opt/havenworld/apps/server/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: [], datasources: { db: { url } } });

const CANONICAL = [
  'users', 'avatars', 'rooms', 'room_furniture', 'inventories', 'friends', 'chat_messages',
  'invite_codes', 'items', 'refresh_tokens', 'pets', 'clubs', 'club_members', 'crafting_queues',
  'achievements', 'daily_quest_progress', 'gallery_photos', 'reports', 'admin_audit_logs',
  'transaction_logs', 'fish_catches', 'fishing_leaderboards', 'guestbook_entries',
  'daily_login_streaks', 'material_inventories', 'minigame_sessions', 'seasonal_events',
  'seasonal_progress', 'game_events', 'photo_likes', 'trade_logs', 'tip_transactions',
  'gift_transactions', 'loft_access', 'passport_frames', 'room_decorators',
  'room_access_logs', 'weekly_earnings_caps',
];

const LEGACY = ['profiles', 'avatar_profiles', 'rooms', 'messages', 'user_friends',
  'user_inventory', 'placed_furniture', 'invite_codes', 'user_reports', 'sessions', 'accounts'];

async function main() {
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  )).map((r) => r.table_name);

  console.log('=== LIVE TABLES (' + tables.length + ') ===');
  for (const t of tables) {
    let n;
    try {
      const r = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM public."' + t + '"');
      n = r[0].n;
    } catch (e) {
      n = 'ERR ' + String(e.message).split('\n')[0].slice(0, 70);
    }
    console.log(String(n).padStart(7) + '  ' + t);
  }

  console.log('\n=== CANONICAL COVERAGE ===');
  const missing = CANONICAL.filter((t) => !tables.includes(t));
  console.log('present: ' + (CANONICAL.length - missing.length) + '/' + CANONICAL.length);
  if (missing.length) console.log('MISSING: ' + missing.join(', '));

  console.log('\n=== _prisma_migrations (ledger) ===');
  if (tables.includes('_prisma_migrations')) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT migration_name, applied_steps_count, finished_at, rolled_back_at,
              left(checksum, 12) AS checksum12 FROM _prisma_migrations ORDER BY migration_name`
    );
    if (!rows.length) console.log('(empty)');
    for (const r of rows) console.log(JSON.stringify(r));
  } else {
    console.log('(table absent)');
  }

  console.log('\n=== LEGACY TABLES (current production data) ===');
  for (const t of LEGACY) {
    if (!tables.includes(t)) continue;
    try {
      const cols = (await prisma.$queryRawUnsafe(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${t}' ORDER BY ordinal_position`
      )).map((c) => c.column_name + ':' + c.data_type);
      const n = (await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM public."' + t + '"'))[0].n;
      console.log('\n' + t + '  (' + n + ' rows)');
      console.log('  ' + cols.join(', '));
    } catch (e) {
      console.log(t + ': ERR ' + String(e.message).split('\n')[0]);
    }
  }

  if (tables.includes('profiles')) {
    console.log('\n=== profiles sample ===');
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT username, left(id::text, 8) AS id8, (auth_user_id IS NOT NULL) AS has_auth,
                (password_hash IS NOT NULL) AS has_pw, coins, gems, created_at
         FROM profiles ORDER BY created_at LIMIT 10`
      );
      if (!rows.length) console.log('(no rows)');
      for (const r of rows) console.log(JSON.stringify(r));
    } catch (e) { console.log('ERR ' + String(e.message).split('\n')[0]); }
  }
}

main()
  .catch((e) => { console.error('FAIL: ' + String(e.message).split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
