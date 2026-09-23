import { request } from '@playwright/test';

export default async function globalSetup() {
  const serverUrl = process.env.VITE_SERVER_URL || 'http://localhost:3000';
  console.log(`[GlobalSetup] Resetting test database on ${serverUrl}...`);

  // Matches the guard in playwright.config.ts: only the locally managed stack is required
  // to prove it is a test target. Live/remote runs (NO_SERVER=1, pages.dev) stay tolerant.
  const localStackEnabled =
    !process.env.NO_SERVER && !process.env.BASE_URL?.includes('pages.dev');

  try {
    const reqContext = await request.newContext();
    const res = await reqContext.post(`${serverUrl}/api/test/reset`);
    if (res.ok()) {
      console.log('[GlobalSetup] Test database reset successfully.');
    } else if (localStackEnabled) {
      // /api/test/reset answers 403 unless the server runs NODE_ENV=test against a *_test
      // database. A refused reset therefore means the server under test is NOT a test server
      // (usually a stale/reused server on port 3000) — running the suite would create real
      // accounts and mutate real data, so abort instead of continuing.
      await reqContext.dispose();
      throw new Error(
        `Refusing to run E2E: ${serverUrl}/api/test/reset returned ${res.status()}. ` +
          'The server under test is not in test mode against a *_test database. ' +
          'Stop any stale server on port 3000 and re-run (or use NO_SERVER=1 with your own test stack).'
      );
    } else {
      console.warn(`[GlobalSetup] Reset route returned status: ${res.status()}`);
    }
    await reqContext.dispose();
  } catch (err: any) {
    if (err?.message?.startsWith('Refusing to run E2E')) throw err;
    console.warn(`[GlobalSetup] Could not reach server at ${serverUrl}: ${err.message}`);
  }
}
