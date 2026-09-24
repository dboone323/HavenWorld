const { PrismaClient } = require('./node_modules/.prisma/client');
const c = new PrismaClient({ log: [] });
(async () => {
  try {
    // sample a profiles row
    const rows = await c.$queryRaw`
      SELECT id::text AS id, COALESCE(email,'')::text AS email, COALESCE(username,'')::text AS username,
             havenCoins::int AS coins, havenGems::int AS gems, COALESCE(authUserId,'')::text AS authUserId,
             passwordHash IS NOT NULL AS hasPassword
      FROM public.profiles ORDER BY created_at DESC LIMIT 2
    `;
    console.log('\nSample profiles (most recent):');
    for (const r of Array.isArray(rows) ? rows : [rows]) {
      console.log(JSON.stringify(Object.assign({}, r), null, 0));
    }
    // auth: does a username login path work via raw (simulate findFirst where username)
    const loginTest = await c.$queryRaw`
      SELECT id::text AS id, passwordHash IS NOT NULL AS hasPass, havenCoins::int AS coins,
             COALESCE(username,'')::text AS username, havenGems::int AS gems
      FROM public.profiles WHERE COALESCE(username,'')::text = 'test'
    `;
    console.log('\nusername= test row (sanity, raw):', JSON.stringify(Array.isArray(loginTest)?loginTest[0]:loginTest));
  } finally { await c.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
