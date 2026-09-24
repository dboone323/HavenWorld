const { PrismaClient } = require('./node_modules/.prisma/client');
async function main() {
  const c = new PrismaClient({ log: [] });
  const tables = await c.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name NOT LIKE 'pgee%'
    ORDER BY table_name
  `;
  console.log('TABLES:\n' + tables.map(r => r.table_name).join('\n'));
  await c.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
