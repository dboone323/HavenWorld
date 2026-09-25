import { PrismaClient } from "/opt/havenworld/node_modules/.prisma/client/index.js";
const p = new PrismaClient();
const r = await p.$queryRaw`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`;
await p.$disconnect();
console.log(JSON.stringify(r));
