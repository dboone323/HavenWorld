const {Client} = require('pg');
const c = new Client({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
(async ()=>{
  await c.connect();
  const tables = ['profiles','rooms','messages','user_friends','user_inventory','placed_furniture','avatar_profiles','invite_codes','user_reports'];
  for (const t of tables) {
    try {
      const r = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`);
      console.log('=== ' + t + ' ===');
      r.rows.forEach(x => console.log(`  ${x.column_name} (${x.data_type}) ${x.is_nullable==='NO'?'NOT NULL':''}`));
      console.log();
    } catch(e) { console.log(t + ': ' + e.message); }
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
