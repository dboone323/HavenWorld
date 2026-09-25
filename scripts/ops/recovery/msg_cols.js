// Run on Oracle with: NODE_PATH=/opt/havenworld/apps/server/node_modules node msg_cols.js
const { Client } = require("pg");
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'messages' ORDER BY ordinal_position");
  console.log("messages columns (" + r.rows.length + "):");
  for (const row of r.rows) {
    console.log(JSON.stringify(row));
  }
  // Also show a sample row to see which id the app actually uses
  const s = await c.query("SELECT * FROM messages LIMIT 1");
  console.log("\nSample row keys:", Object.keys(s.rows[0]));
  c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
