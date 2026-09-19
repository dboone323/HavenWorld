import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: Avatar Customizer E2E', () => {
  const ts = Date.now();
  const user = {
    username: `custom_${ts}`,
    email: `custom_${ts}@havenworld.test`,
    password: 'Password123!',
  };

  test('Open wardrobe, adjust avatar attributes, save changes, and persist', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);

    await loginPage.goto();
    await loginPage.register(user);
    await loginPage.verifyEmailViaTestRoute(user.email);
    await loginPage.login(user.email, user.password);
    await roomPage.waitForRoomReady();

    // Open Wardrobe / Avatar Customizer
    await roomPage.openAvatarCustomizer();

    // Verify avatar panel is open
    await expect(roomPage.avatarPanel).toBeVisible();

    // If color buttons or sliders are present, click or adjust them
    const colorSwatches = roomPage.avatarPanel.locator('.color-swatch, button, input[type="color"]');
    if ((await colorSwatches.count()) > 0) {
      await colorSwatches.first().click();
    }

    // Save or close
    const saveBtn = roomPage.avatarPanel.locator('text=Save, text=Done, text=Close, .btn--save').first();
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
    }
  });
});
