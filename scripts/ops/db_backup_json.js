#!/usr/bin/env node
// db_backup_json.js — version-independent backup of every table in the live DB to JSON.
// Usage: cd /opt/havenworld/apps/server && node /tmp/db_backup_json.js /tmp/db_backup.json
'use strict';
const fs = require('fs');
const OUT = process.argv[2] || '/tmp/db_backup.json';
const ENV = '/opt/havenworld/apps/server/.env';

let url = process.env.DATABASE_URL;
if (!url) {
  const m = fs.readFileSync(ENV, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  if (m) url = m[1].trim().replace(/^["']|["']$/g, '');
}
const { PrismaClient } = require('/opt/havenworld/apps/server/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: [], datasources: { db: { url } } });

const replacer = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  )).map((r) => r.table_name);

  const dump = { takenAt: new Date().toISOString(), source: 'havenworld live DB (pre-migration)', tables: {} };

  for (const t of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe('SELECT * FROM public."' + t + '"');
      dump.tables[t] = { rowCount: rows.length, rows };
      console.log(t + ': ' + rows.length + ' rows');
    } catch (e) {
      dump.tables[t] = { error: String(e.message).split('\n')[0] };
      console.log(t + ': ERROR ' + String(e.message).split('\n')[0]);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(dump, replacer, 2));
  console.log('\nwritten: ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
}

main().catch((e) => { console.error('FAIL: ' + String(e.message).split('\n')[0]); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
