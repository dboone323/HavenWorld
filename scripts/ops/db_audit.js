#!/usr/bin/env node
// db_audit.js — read-only audit of the live HavenWorld DB.
// Run from /opt/havenworld/apps/server so `pg` resolves from the workspace.
'use strict';
const fs = require('fs');

let pg;
try {
  pg = require('pg');
} catch (e) {
  // pnpm layout fallback
  const base = '/opt/havenworld/node_modules/.pnpm';
  const dir = fs.readdirSync(base).find((d) => d.startsWith('pg@'));
  pg = require(`${base}/${dir}/node_modules/pg`);
}

let url = process.argv[2];
if (!url) {
  const env = fs.readFileSync('/opt/havenworld/apps/server/.env', 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (m) url = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!url) { console.error('no DATABASE_URL'); process.exit(1); }

const client = new pg.Client({ connectionString: url });

(async () => {
  await client.connect();

  const tables = (await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`
  )).rows.map((r) => r.table_name);

  console.log('=== TABLES (' + tables.length + ') ===');
  for (const t of tables) {
    let n = '?';
    try {
      n = (await client.query(`SELECT COUNT(*)::int AS n FROM public."${t}"`)).rows[0].n;
    } catch (e) { n = 'ERR ' + e.message.split('\n')[0]; }
    console.log(`${String(n).padStart(7)}  ${t}`);
  }

  console.log('\n=== _prisma_migrations ===');
  const hasLedger = tables.includes('_prisma_migrations');
  if (hasLedger) {
    const rows = (await client.query(
      `SELECT migration_name, applied_steps_count, finished_at, rolled_back_at,
              left(checksum, 12) AS checksum12
       FROM _prisma_migrations ORDER BY migration_name`
    )).rows;
    for (const r of rows) console.log(JSON.stringify(r));
  } else {
    console.log('(absent)');
  }

  console.log('\n=== users / avatars present? ===');
  for (const t of ['users', 'avatars', 'rooms', 'chat_messages', 'room_furniture', 'inventories', 'friends', 'invite_codes', 'refresh_tokens']) {
    console.log(`${t}: ${tables.includes(t) ? 'EXISTS' : 'MISSING'}`);
  }

  console.log('\n=== legacy sample (updated-account check) ===');
  if (tables.includes('profiles')) {
    const rows = (await client.query(
      `SELECT username, left(id, 8) AS id8, (auth_user_id IS NOT NULL) AS has_auth,
              (password_hash IS NOT NULL) AS has_pw, coins, gems, created_at
       FROM profiles ORDER BY created_at LIMIT 10`
    )).rows;
    for (const r of rows) console.log(JSON.stringify(r));
  }

  await client.end();
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
