import * as dotenv from 'dotenv';
import * as path from 'path';

export default async function globalTeardown() {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
  console.log('[globalTeardown] Cleaning up test database...');
  const { truncateAllTables } = await import('../__tests__/helpers/dbHelpers');
  const { prisma } = await import('../src/prisma');
  await truncateAllTables();
  await prisma.$disconnect();
  console.log('[globalTeardown] Test database cleaned and disconnected.');
}
