import * as dotenv from 'dotenv';
import * as path from 'path';

export default async function globalTeardown() {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
  console.log('[globalTeardown] Cleaning up test database...');
  const { truncateAllTables, seedMinimalData } = await import('../__tests__/helpers/dbHelpers');
  const { prisma } = await import('../src/prisma');
  await truncateAllTables();
  // TRUNCATE ... CASCADE also wipes the reference catalogue (items) and the public rooms,
  // because rooms/items are reached via the users CASCADE. Leaving the database empty is what
  // produced the "ghost account" bug: register() commits user/avatar/room and then 500s in
  // grantDefaultItems() on inventories_itemId_fkey because the items table has no rows.
  // Anything that runs after Jest (Playwright via `make test-e2e` without an intermediate
  // `make push-schema`, or a dev server pointed at this database) must not inherit that state,
  // so the fixture is restored here. Use `make push-schema` for the full production-like seed.
  await seedMinimalData();
  await prisma.$disconnect();
  console.log('[globalTeardown] Test database cleaned, minimal catalogue restored.');
}
