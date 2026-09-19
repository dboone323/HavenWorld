import { request } from '@playwright/test';

export default async function globalTeardown() {
  const serverUrl = process.env.VITE_SERVER_URL || 'http://localhost:3000';
  console.log(`[GlobalTeardown] Cleaning up test data on ${serverUrl}...`);

  try {
    const reqContext = await request.newContext();
    const res = await reqContext.post(`${serverUrl}/api/test/cleanup`, {
      data: {},
    });
    if (res.ok()) {
      console.log('[GlobalTeardown] Test cleanup completed.');
    }
    await reqContext.dispose();
  } catch (err: any) {
    console.warn(`[GlobalTeardown] Cleanup warning: ${err.message}`);
  }
}
