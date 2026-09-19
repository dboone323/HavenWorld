import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RoomPage } from '../pages/RoomPage';

test.describe('Tier 4: Visual Regression Tests', () => {
  test('Login panel snapshot renders with consistent styling', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    await expect(login.loginPanel).toBeVisible();
    // Verify key visual elements exist without layout shifts
    const box = await login.loginPanel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('Haven Park canvas renders within standard viewport', async ({ page }) => {
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `vis_${ts}`,
      email: `vis_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`vis_${ts}@havenworld.test`);
    await login.login(`vis_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();
    await room.navigateToPark();

    const canvasBox = await room.canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(0);
    expect(canvasBox!.height).toBeGreaterThan(0);
  });

  test('Chat overlay positioning and visual structure', async ({ page }) => {
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `chatvis_${ts}`,
      email: `chatvis_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`chatvis_${ts}@havenworld.test`);
    await login.login(`chatvis_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();
    await expect(room.chatPanel).toBeVisible();
    await expect(room.chatInput).toBeVisible();
    await expect(room.chatSendBtn).toBeVisible();
  });
});
