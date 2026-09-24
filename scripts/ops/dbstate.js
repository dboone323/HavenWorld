const {Client} = require('pg');
const c = new Client({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
(async ()=>{
  await c.connect();
  const r = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  console.log('=== TABLES ===');
  r.rows.forEach(x => console.log('  ' + x.tablename));
  console.log();
  console.log('=== _prisma_migrations ===');
  const m = await c.query("SELECT id, checksum, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5");
  if (m.rows.length===0) console.log('  (empty)');
  else m.rows.forEach(x => console.log('  ' + JSON.stringify(x)));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
