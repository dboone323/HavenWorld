const { Client } = require('pg');
const fs = require('fs');
const env = {};
fs.readFileSync('/opt/havenworld/apps/server/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
});
(async () => {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='_prisma_migrations' ORDER BY ordinal_position`);
  console.log('MIGRATION_LEDGER_COLUMNS:', cols.rows.map(r => r.column_name).join(','));
  const r = await c.query('SELECT * FROM _prisma_migrations ORDER BY finished_at');
  console.log('--- ledger rows ---');
  r.rows.forEach(x => console.log(JSON.stringify(x)));
  const t = await c.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', ['public']);
  console.log('--- actual tables ---');
  console.log(t.rows.map(x => x.tablename).join(', '));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
