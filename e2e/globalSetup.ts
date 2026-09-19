import { request } from '@playwright/test';

export default async function globalSetup() {
  const serverUrl = process.env.VITE_SERVER_URL || 'http://localhost:3000';
  console.log(`[GlobalSetup] Resetting test database on ${serverUrl}...`);

  try {
    const reqContext = await request.newContext();
    const res = await reqContext.post(`${serverUrl}/api/test/reset`);
    if (res.ok()) {
      console.log('[GlobalSetup] Test database reset successfully.');
    } else {
      console.warn(`[GlobalSetup] Reset route returned status: ${res.status()}`);
    }
    await reqContext.dispose();
  } catch (err: any) {
    console.warn(`[GlobalSetup] Could not reach server at ${serverUrl}: ${err.message}`);
  }
}
