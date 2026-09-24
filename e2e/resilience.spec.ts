import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

/**
 * Tier 5: Resilience - offline shell, socket reconnect, asset fallbacks.
 */
test.describe('Tier 5: Resilience', () => {
  async function registerAndLogin(page: Page): Promise<RoomPage> {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const testUser = {
      username: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      email: `resil_${unique}@havenworld.test`,
      password: 'SecurePassword123!',
    };
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);
    await loginPage.goto();
    await loginPage.register({
      username: testUser.username,
      email: testUser.email,
      password: testUser.password,
    });
    await loginPage.verifyEmailViaTestRoute(testUser.email);
    await loginPage.login(testUser.email, testUser.password);
    await roomPage.waitForRoomReady(20_000);
    return roomPage;
  }

  test('offline: the app shell loads from the service worker with no network', async ({
    page,
    context,
  }) => {
    // Warm the SW cache while online: visit once, then wait until the SW
    // controls the page (install -> per-asset shell caching -> activate).
    await page.goto('/');
    await expect(page.locator('[data-testid="login-panel"]')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, {
      timeout: 15_000,
    });

    try {
      await context.setOffline(true);
      await page.reload();
      // The SW navigate handler must serve the cached shell instead of the
      // browser's offline error page.
      await expect(page.locator('[data-testid="login-panel"]')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.setOffline(false);
    }
  });

  test('socket: reconnect banner appears on transport failure and manual reconnect recovers', async ({
    page,
    context,
  }) => {
    await registerAndLogin(page);

    // Precondition: the socket is actually connected.
    await page.waitForFunction(() => (window as any).__havenSocket?.connected === true, {
      timeout: 15_000,
    });

    // Keep the exhaustion phase short and deterministic in this test.
    await page.evaluate(() => {
      (window as any).__havenSocket.socket.io.reconnectionAttempts(3);
    });

    // Drop the browser network entirely. This closes the live engine and makes
    // every subsequent polling/WebSocket handshake fail without relying on
    // `page.routeWebSocket`, which does not intercept service-worker-controlled
    // pages consistently across Playwright versions.
    await context.setOffline(true);
    // Chromium does not always close an already-open WebSocket immediately
    // when CDP switches the context offline. Close the live Engine.IO transport
    // after the network is down so Socket.IO observes a genuine transport drop.
    await page.evaluate(() => {
      (window as any).__havenSocket.socket.io.engine.close();
    });

    const banner = page.locator('[data-testid="connection-banner"]');
    const reconnectBtn = page.locator('[data-testid="connection-reconnect-btn"]');

    // The banner must appear while retries are in flight...
    await expect(banner).toBeVisible({ timeout: 15_000 });
    // ...and after the attempts are exhausted it must offer a manual retry.
    await expect(banner).toContainText("Couldn't reconnect", { timeout: 30_000 });
    await expect(reconnectBtn).toBeVisible();

    // Restore the network, then click through: a fresh handshake should hide
    // the banner and bring the socket back.
    await context.setOffline(false);
    await reconnectBtn.click();

    await expect(banner).toBeHidden({ timeout: 30_000 });
    await page.waitForFunction(() => (window as any).__havenSocket?.connected === true, {
      timeout: 30_000,
    });
  });

  test('room GLB 404 falls back to a procedural room with a detailed warning', async ({
    page,
  }) => {
    const roomPage = await registerAndLogin(page);

    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // Force every room GLB to 404, then travel to the park. The room must
    // still load (procedural prefab) instead of throwing.
    await page.route('**/assets/rooms/*.glb', (route) =>
      route.fulfill({ status: 404, contentType: 'model/gltf-binary', body: '' })
    );
    await roomPage.navigateToPark();

    await expect(roomPage.canvas).toBeVisible();
    expect(warnings.some((w) => w.includes('Room GLB load failed'))).toBe(true);
    expect(warnings.some((w) => w.includes('/assets/rooms/room-park.glb'))).toBe(true);
    expect(pageErrors).toEqual([]);

    await page.unrouteAll({ behavior: 'wait' });
  });
});
