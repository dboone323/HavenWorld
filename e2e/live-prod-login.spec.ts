import { test, expect } from '@playwright/test';

const PROD_URL = 'https://havenworld-game.pages.dev';
const BACKEND_URL = 'https://147-224-184-148.nip.io';

test.describe('Live Production E2E Tests - HavenWorld Web Client', () => {
  test.beforeEach(async ({ page }) => {
    // Collect all console logs and network errors
    page.on('console', (msg) => {
      console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error(`[BROWSER UNCAUGHT ERROR] ${err.message}`);
    });
  });

  test('Live login with valid credentials transitions into game successfully', async ({ page }) => {
    console.log(`Navigating to live production site: ${PROD_URL}`);
    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });

    // 1. Verify Login Panel is displayed
    const loginPanel = page.locator('#login-panel');
    await expect(loginPanel).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'playwright-report/live-step1-login-screen.png' });

    // 2. Set up request/response interceptors to track backend calls
    let loginRequestUrl = '';
    let loginResponseStatus = 0;
    let loginResponseBody: any = null;

    page.on('request', (req) => {
      if (req.url().includes('/api/auth/login')) {
        loginRequestUrl = req.url();
        console.log(`[AUTH REQUEST] ${req.method()} ${req.url()}`);
      }
    });

    page.on('response', async (res) => {
      if (res.url().includes('/api/auth/login')) {
        loginResponseStatus = res.status();
        try {
          loginResponseBody = await res.json();
        } catch {
          // ignore non-json
        }
        console.log(`[AUTH RESPONSE] ${res.status()} ${res.url()}`);
      }
    });

    // 3. Fill in live credentials
    await page.locator('#login-email').fill('testalpha@havenworld.dev');
    await page.locator('#login-password').fill('HavenAlpha2026!');

    // 4. Submit form
    console.log('Submitting login form...');
    await page.locator('#login-submit').click();

    // 5. Assert the backend API was called at the correct Oracle VM address (NOT the static Pages host)
    await expect.poll(() => loginResponseStatus, { timeout: 15_000 }).toBe(200);
    expect(loginRequestUrl).toContain(BACKEND_URL);
    expect(loginRequestUrl).not.toContain('pages.dev');
    expect(loginResponseBody).toHaveProperty('accessToken');
    expect(loginResponseBody.user.username).toBe('TestTester');

    console.log(`✓ Login succeeded! Access token received for user: ${loginResponseBody.user.username}`);

    // 6. Assert Login Panel is dismissed
    await expect(loginPanel).not.toBeVisible({ timeout: 15_000 });

    // 7. Verify Babylon Canvas / Game elements are rendered
    const canvas = page.locator('#haven-canvas');
    await expect(canvas).toBeAttached();

    // Wait a brief moment for scene initialization
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'playwright-report/live-step2-game-scene.png' });

    console.log('✓ Scene loaded and screenshot captured!');
  });

  test('Live login with invalid credentials shows descriptive error without crash', async ({ page }) => {
    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });

    const loginPanel = page.locator('#login-panel');
    await expect(loginPanel).toBeVisible({ timeout: 15_000 });

    let failedStatus = 0;
    page.on('response', (res) => {
      if (res.url().includes('/api/auth/login')) {
        failedStatus = res.status();
      }
    });

    await page.locator('#login-email').fill('testalpha@havenworld.dev');
    await page.locator('#login-password').fill('CompletelyWrongPassword123!');
    await page.locator('#login-submit').click();

    await expect.poll(() => failedStatus, { timeout: 15_000 }).toBe(401);

    const errorEl = page.locator('#login-error');
    await expect(errorEl).toBeVisible();
    const errorText = await errorEl.textContent();
    expect(errorText).toMatch(/AUTHENTICATION_FAILED|Invalid email or password/i);
    console.log(`✓ Invalid credentials correctly returned 401 with UI message: "${errorText}"`);
  });
});
