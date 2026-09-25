const {Client} = require('pg');

async function main() {
  const c = new Client({connectionString: process.env.DATABASE_URL});
  await c.connect();

  // ---- all tables + exact columns + PK + FK ----
  const tables = await c.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`
  );
  console.log('===== TABLES (' + tables.rows.length + ') =====');
  tables.rows.forEach(t => console.log('  ' + t.table_name));

  for (const row of tables.rows) {
    const t = row.table_name;
    const cols = await c.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`, [t]
    );
    console.log('\n===== ' + t + ' =====');
    cols.rows.forEach(x =>
      console.log(
        '  ' + x.column_name.padEnd(22) +
        x.data_type.padEnd(22) +
        (x.is_nullable === 'NO' ? '  NOT NULL' : '') +
        (x.column_default ? '  DEFAULT ' + x.column_default : '')
      )
    );

    const pk = await c.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_schema='public'
         AND tc.table_name=$1
         AND tc.constraint_type='PRIMARY KEY'
       ORDER BY kcu.ordinal_position`, [t]
    );
    if (pk.rows.length)
      console.log('  PRIMARY KEY: (' + pk.rows.map(x => x.column_name).join(', ') + ')');

    const fk = await c.query(
      `SELECT kcu.column_name, ccu.table_name
       FROM information_schema.key_column_usage kcu
       JOIN information_schema.referential_constraints rc
         ON kcu.constraint_name = rc.constraint_name
        AND kcu.position_in_unique_constraint IS NOT NULL
       JOIN information_schema.constraint_column_usage ccu
         ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.unique_constraint_schema = ccu.constraint_schema
       WHERE kcu.table_schema='public'
         AND kcu.table_name=$1
       ORDER BY kcu.ordinal_position`, [t]
    );
    fk.rows.forEach(x =>
      console.log('  FK ' + x.column_name + ' -> ' + x.table_name)
    );
  }

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
