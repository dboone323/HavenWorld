#!/usr/bin/env node
// dump_schema.js — reads DATABASE_URL from /opt/havenworld/apps/server/.env
// argv[2] = optional explicit URL (overrides .env)
"use strict";
const fs = require('fs');
const { Client } = require('pg');
let dbUrl = process.argv[2];
if (!dbUrl) {
  try {
    const env = fs.readFileSync('/opt/havenworld/apps/server/.env', 'utf8');
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) dbUrl = m[1].trim();
  } catch (e) {}
}
if (!dbUrl) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: dbUrl });
(async () => {
  await client.connect();
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    AND table_name NOT LIKE 'pg_%' AND table_name != 'spatial_ref_sys'
    ORDER BY table_name`);
  console.log('TABLES (' + tables.rows.length + '):', tables.rows.map(r=>r.table_name).join(', '));
  await client.end();
})().catch(e => { console.error(e.message || e); process.exit(1); });
