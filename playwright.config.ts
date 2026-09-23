import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

// Two env files, two different consumers:
//   .env.test ............... the VITE_* URLs the browser under test must call
//   apps/server/.env.test ... the E2E server's DATABASE_URL / REDIS_URL / JWT secrets
// The server env is passed explicitly to the webServer below. Without it the server's
// `import 'dotenv/config'` fell back to apps/server/.env — the production Supabase pooler —
// so `make test-e2e` booted an API server pointed at production: register stalled in its
// interactive $transaction on the pooler, and /api/test/reset aimed at live data.
dotenv.config({ path: path.resolve(__dirname, '.env.test') });

const SERVER_TEST_ENV_PATH = path.resolve(__dirname, 'apps/server/.env.test');
const SERVER_URL = 'http://localhost:3000';
const SERVER_PORT = '3000';

const serverEnv: Record<string, string> = fs.existsSync(SERVER_TEST_ENV_PATH)
  ? dotenv.parse(fs.readFileSync(SERVER_TEST_ENV_PATH))
  : {};

// An explicitly exported variable still wins over the file, matching dotenv's own precedence.
for (const key of Object.keys(serverEnv)) {
  const exported = process.env[key];
  if (exported !== undefined) serverEnv[key] = exported;
}

Object.assign(serverEnv, {
  NODE_ENV: 'test',
  SERVER_AUTOSTART: 'true',
  PORT: SERVER_PORT,
});

const localStackEnabled =
  !process.env.NO_SERVER && !process.env.BASE_URL?.includes('pages.dev');

// Fail fast rather than silently end-to-end testing against production.
// Bypass with E2E_ALLOW_NON_TEST_DB=1 only if you know why.
if (localStackEnabled && !process.env.E2E_ALLOW_NON_TEST_DB) {
  const target = serverEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? '';
  if (!target.includes('_test')) {
    const masked = target.replace(/:\/\/([^:@/]+)(:[^@]*)?@/, '://$1:***@') || '(unset)';
    throw new Error(
      `Refusing to start the E2E stack: DATABASE_URL is not a *_test database (${masked}). ` +
        'Expected e.g. postgresql://...@127.0.0.1:5432/havenworld_test from apps/server/.env.test.'
    );
  }
}

export default defineConfig({
  testDir: './e2e',
  // live-*.spec.ts target https://havenworld-game.pages.dev with hardcoded demo
  // credentials, so they must never run in a default local/CI pass. Opt in:
  //   E2E_LIVE=1 npx playwright test e2e/live-prod-login.spec.ts
  testIgnore: process.env.E2E_LIVE ? undefined : ['**/live-*.spec.ts'],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  globalSetup: (process.env.NO_SERVER || process.env.BASE_URL?.includes('pages.dev')) ? undefined : './e2e/globalSetup.ts',
  globalTeardown: (process.env.NO_SERVER || process.env.BASE_URL?.includes('pages.dev')) ? undefined : './e2e/globalTeardown.ts',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: !localStackEnabled ? undefined : [
    {
      command: 'pnpm --filter server dev',
      env: serverEnv,
      url: `${SERVER_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter client dev --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
