import * as dotenv from 'dotenv';
import * as path from 'path';

export default async function globalTeardown() {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
  const isUnitOnly =
    process.argv.some((arg) => arg.includes('unit') || arg.includes('src/services/__tests__')) ||
    process.env.SKIP_DB_SETUP === 'true';

  if (isUnitOnly) {
    return;
  }

  console.log('[globalTeardown] Cleaning up test database...');
  try {
    const { truncateAllTables, seedMinimalData } = await import('../__tests__/helpers/dbHelpers');
    const { prisma } = await import('../src/prisma');
    await truncateAllTables();
    await seedMinimalData();
    await prisma.$disconnect();
    console.log('[globalTeardown] Test database cleaned, minimal catalogue restored.');
  } catch (err) {
    console.warn('[globalTeardown] Database offline; skipping teardown.');
  }
}
