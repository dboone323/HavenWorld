import { PrismaClient } from "/opt/havenworld/apps/server/node_modules/.prisma/client/index.js";
const p = new PrismaClient();
const r = await p.$queryRaw`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`;
await p.$disconnect();
import fs from "fs";
fs.writeFileSync("/opt/havenworld/logs/local/recovery-json/live_cols.json", JSON.stringify(r, null, 1));
console.log("DONE:", r.length, "rows");
