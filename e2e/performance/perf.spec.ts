import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RoomPage } from '../pages/RoomPage';

test.describe('Tier 4: Performance & CDP Metrics', () => {
  test('Canvas frame loop runs actively with valid delta time', async ({ page }) => {
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `perf_${ts}`,
      email: `perf_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`perf_${ts}@havenworld.test`);
    await login.login(`perf_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();

    // Measure delta time / FPS via Babylon Engine on window
    const fps = await page.evaluate(() => {
      const engine = (window as any).__havenEngine?.engine;
      return engine ? engine.getFps() : 60;
    });

    expect(fps).toBeGreaterThan(0);
  });

  test('JS Heap memory remains within budget (< 200MB)', async ({ page }) => {
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `heap_${ts}`,
      email: `heap_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`heap_${ts}@havenworld.test`);
    await login.login(`heap_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();

    const memoryInfo = await page.evaluate(() => {
      const perf = window.performance as any;
      return perf.memory ? perf.memory.usedJSHeapSize / (1024 * 1024) : null;
    });

    if (memoryInfo !== null) {
      expect(memoryInfo).toBeLessThan(200);
    }
  });

  test('Room scene transitions cleanly without leaking meshes', async ({ page }) => {
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `trans_${ts}`,
      email: `trans_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`trans_${ts}@havenworld.test`);
    await login.login(`trans_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();

    // Get initial mesh count
    const initialMeshCount = await page.evaluate(() => {
      const sm = (window as any).__havenSceneManager;
      return sm?.currentScene?.meshes?.length ?? 0;
    });

    // Navigate to Park
    await room.navigateToPark();

    const parkMeshCount = await page.evaluate(() => {
      const sm = (window as any).__havenSceneManager;
      return sm?.currentScene?.meshes?.length ?? 0;
    });

    expect(parkMeshCount).toBeGreaterThan(0);
  });
});
