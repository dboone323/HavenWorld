const { PrismaClient } = require('./node_modules/.prisma/client');
const c = new PrismaClient({ log: [] });
(async () => {
  try {
    // table list
    const t = await c.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE 'pgee%' ORDER BY table_name
    `;
    console.log('Live tables:\n' + t.map(r => r.table_name).join('\n'));
    // count rows in the 7 auth/data tables
    const tables = ['profiles','avatar_profiles','rooms','messages','user_friends','user_inventory','placed_furniture','invite_codes','user_reports','sessions','accounts','saved_furniture','font_choice','font_style','furniture_template'];
    for (let i = 0; i < tables.length; i++) {
      try {
        const r = await c.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM public."${tables[i]}" WHERE 1=1`);
        const row = Array.isArray(r) ? r[0] : r;
        console.log(`${tables[i]}: ${row && row.n != null ? row.n : '?'}`);
      } catch (e) {
        console.log(`${tables[i]}: MISSING/ERR (${e.message.split('\n')[0]})`);
      }
    }
  } finally { await c.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
