import * as dotenv from 'dotenv';
import * as path from 'path';

export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl || !dbUrl.includes('_test')) {
    throw new Error(
      `SAFETY: DATABASE_URL does not contain "_test". Got: ${dbUrl}. Refusing to run global setup.`
    );
  }

  console.log('[globalSetup] Seeding minimal test data into havenworld_test...');
  const { seedMinimalData } = await import('../__tests__/helpers/dbHelpers');
  await seedMinimalData();
  console.log('[globalSetup] Minimal test data seeded successfully.');
}
