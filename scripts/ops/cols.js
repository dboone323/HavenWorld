const { Client } = require('/tmp/pgq/node_modules/pg');
const fs = require('fs');
const env = {};
fs.readFileSync('/opt/havenworld/apps/server/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
});
(async () => {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  for (const t of ['profiles','rooms','user_inventory','placed_furniture','avatar_profiles','messages','user_friends']) {
    const cols = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
    console.log(`--- ${t} ---`);
    cols.rows.forEach(r => console.log(`  ${r.column_name.padEnd(25)} ${r.data_type.padEnd(15)} nullable=${r.is_nullable}`));
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
