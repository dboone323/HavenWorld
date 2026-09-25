#!/usr/bin/env node
// dump_schema2.js — full schema dump to /opt/havenworld/tmp/schema.json
// reads DATABASE_URL from /opt/havenworld/apps/server/.env
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
  const out = { tables: {}, enums: [] };
  // enums
  const enumRows = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE t.typtype='e' ORDER BY t.typname, e.enumsortord`);
  for (const r of enumRows.rows) {
    (out.enums[r.typname] ||= []).push(r.enumlabel);
  }
  out.enums = Object.entries(out.enums).map(([n,v]) => ({ name:n, values:v }));
  // columns
  const cols = await client.query(`
    SELECT table_schema, table_name, column_name, ordinal_position,
      data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale,
      is_nullable, column_default, domain_name
    FROM information_schema.columns
    WHERE table_schema='public'
    ORDER BY table_name, ordinal_position`);
  for (const c of cols.rows) {
    const t = c.table_name;
    if (!out.tables[t]) out.tables[t] = { columns: [], pk: [], uniq: [], fk: [], check: [] };
    const cc = { name: c.column_name, nullable: c.is_nullable==='YES' };
    cc.type = c.data_type;
    if (c.udt_name === 'uuid' || cc.type === 'uuid') cc.type = 'uuid';
    if (c.data_type === 'character varying') cc.type = 'varchar' + (c.character_maximum_length? '('+c.character_maximum_length+')':'');
    if (c.data_type === 'timestamp without time zone') cc.type = 'timestamp';
    if (c.data_type === 'timestamp with time zone') cc.type = 'timestamptz';
    if (c.numeric_scale!=null && c.numeric_scale===0 && c.data_type==='numeric') cc.type = 'int4';
    if (c.numeric_scale!=null && c.numeric_scale===2 && c.data_type==='numeric') cc.type = 'numeric(10,2)';
    if (c.data_type === 'json' || c.data_type === 'jsonb') cc.type = c.data_type;
    if (c.numeric_precision != null && c.numeric_scale != null && c.data_type==='numeric') cc.type = `numeric(${c.numeric_precision},${c.numeric_scale})`;
    if (c.is_nullable==='NO') cc.required = true;
    if (c.column_default && c.column_default !== 'NULL') cc.default = c.column_default;
    if (c.domain_name && c.domain_name !== c.udt_name) cc.domain = c.domain_name;
    out.tables[t].columns.push(cc);
  }
  // constraints
  const cons = await client.query(`
    SELECT tc.table_name, ku.column_name, tc.constraint_name,
      CASE tc.constraint_type
        WHEN 'PRIMARY KEY' THEN 'pk'
        WHEN 'UNIQUE' THEN 'uniq'
        WHEN 'FOREIGN KEY' THEN 'fk'
        WHEN 'CHECK' THEN 'check'
      END AS ct,
      ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
      ccu.column_name AS ref_column, pg_get_constraintdef(tc.oid) AS clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
      ON ku.constraint_schema=tc.constraint_schema AND ku.constraint_name=tc.constraint_name
    LEFT JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema=tc.constraint_schema AND ccu.constraint_name=tc.constraint_name
    WHERE tc.constraint_schema='public'
    ORDER BY tc.table_name, tc.constraint_type, ku.ordinal_position`);
  for (const r of cons.rows) {
    const t = r.table_name;
    if (!out.tables[t]) continue;
    if (r.ct==='pk') out.tables[t].pk.push(r.column_name);
    if (r.ct==='uniq') out.tables[t].uniq.push(r.column_name);
    if (r.ct==='fk' && r.ref_table && r.ref_column) out.tables[t].fk.push({ from:r.column_name, to:r.ref_table, toCol:r.ref_column });
    if (r.ct==='check') out.tables[t].check.push(r.clause);
  }
  // indexes (non-constraint)
  const idxs = await client.query(`
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`);
  for (const r of idxs.rows) {
    const t = r.tablename;
    if (!out.tables[t]) continue;
    if (!out.tables[t].indexes) out.tables[t].indexes = [];
    out.tables[t].indexes.push(r.indexdef);
  }
  await client.end();
  fs.writeFileSync('/opt/havenworld/tmp/schema.json', JSON.stringify(out, null, 2));
  console.log('WROTE /opt/havenworld/tmp/schema.json');
})().catch(e => { console.error(e.message || e); process.exit(1); });
