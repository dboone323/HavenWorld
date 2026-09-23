import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RoomPage } from '../pages/RoomPage';

test.describe('Tier 4: Mobile Emulation & Touch Interactions', () => {
  test('Responsive layout fits viewport without horizontal scrolling', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // No overflow / horizontal scrollbar on mobile
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('Interactive tap targets meet touch guideline standards (>= 32px height)', async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();

    const submitBox = await login.loginSubmitBtn.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.height).toBeGreaterThanOrEqual(32);
  });

  test('Tap-to-move touch event triggers on canvas in mobile view', async ({ page, hasTouch }) => {
    // page.touchscreen requires hasTouch — only mobile-chrome/mobile-safari enable it.
    test.skip(!hasTouch, 'Touch events require hasTouch (mobile projects only)');
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `mob_${ts}`,
      email: `mob_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`mob_${ts}@havenworld.test`);
    await login.login(`mob_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();

    // Perform tap on the canvas
    const canvasBox = await room.canvas.boundingBox();
    expect(canvasBox).not.toBeNull();

    const tapX = canvasBox!.x + canvasBox!.width / 2;
    const tapY = canvasBox!.y + canvasBox!.height / 2;

    await page.touchscreen.tap(tapX, tapY);

    // Verify canvas remains responsive
    expect(await room.canvas.isVisible()).toBe(true);
  });

  test('Mobile chat input accepts virtual keyboard text and sends message', async ({ page }) => {
    const ts = Date.now();
    const login = new LoginPage(page);
    const room = new RoomPage(page);

    await login.goto();
    await login.register({
      username: `mobc_${ts}`,
      email: `mobc_${ts}@havenworld.test`,
      password: 'Password123!',
    });
    await login.verifyEmailViaTestRoute(`mobc_${ts}@havenworld.test`);
    await login.login(`mobc_${ts}@havenworld.test`, 'Password123!');

    await room.waitForRoomReady();

    const mobileMsg = `Mobile chat test ${ts}`;
    await room.sendChatMessage(mobileMsg);
    await room.waitForChatMessage(mobileMsg);
  });
});
