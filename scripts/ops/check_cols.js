const { PrismaClient } = require('./node_modules/.prisma/client');
async function main() {
  const c = new PrismaClient({ log: [] });
  const cols = await c.$queryRaw`
    SELECT table_name, column_name, data_type,
           COALESCE(column_default, '-') AS default_val,
           is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('profiles','avatar_profiles','rooms','messages','user_friends','user_inventory','placed_furniture')
    ORDER BY table_name, ordinal_position
  `;
  let cur = '';
  const lines = cols.map(r => {
    if (r.table_name !== cur) { cur = r.table_name; return '---\n' + r.table_name; }
    return `  ${String(r.column_name).padEnd(22)} ${String(r.data_type).padEnd(12)} ${String(r.default_val).slice(0,18).padEnd(18)} ${r.is_nullable}`;
  });
  console.log(lines.join('\n'));
  await c.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
