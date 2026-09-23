import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { RoomPage } from './pages/RoomPage';

test.describe('Tier 4: Personal Loft Decorating & Room Controls E2E', () => {
  const ts = Date.now().toString().slice(-6);
  const ownerUser = {
    username: `loft_${ts}`,
    email: `loft_${ts}@havenworld.test`,
    password: 'Password123!',
  };

  test('Owner controls, 4-way furniture rotation, decorator mode, and privacy settings', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);

    // 1. Register and login to personal sanctuary loft
    await loginPage.goto();
    await loginPage.register(ownerUser);
    await loginPage.verifyEmailViaTestRoute(ownerUser.email);
    await loginPage.login(ownerUser.email, ownerUser.password);
    await roomPage.waitForRoomReady();

    // 2. Owner-only HUD elements are present
    await expect(roomPage.btnDecorate).toBeVisible({ timeout: 5_000 });
    await expect(roomPage.btnLoftSettings).toBeVisible({ timeout: 5_000 });
    await expect(roomPage.roomControlsCard).toBeVisible({ timeout: 5_000 });

    // 3. Room Lock Switch toggle via styled slider
    const switchSlider = page.locator('#room-controls-card .slider');
    await expect(switchSlider).toBeVisible();
    await switchSlider.click();
    expect(await roomPage.chkRoomLock.isChecked()).toBe(true);
    await switchSlider.click();
    expect(await roomPage.chkRoomLock.isChecked()).toBe(false);

    // 4. Loft Settings & Mood Modal
    await roomPage.btnLoftSettings.click();
    await expect(roomPage.loftSettingsClose).toBeVisible({ timeout: 5_000 });
    // Verify privacy modes are present
    await expect(page.locator('input[name="privacy-mode"]')).toHaveCount(4);
    // Close loft settings
    await roomPage.loftSettingsClose.click();
    await expect(roomPage.loftSettingsClose).not.toBeVisible();

    // 5. Decorator Mode & 4-Way Rotation
    // Click dock decorate button to enter edit mode
    await roomPage.btnDecorate.click();
    await expect(roomPage.roomEditorInventory).toBeVisible({ timeout: 5_000 });
    await expect(roomPage.editorRotLabel).toContainText('0° (South)');

    // Rotate via UI button: 0° -> 90° -> 180°
    await roomPage.btnEditorRotate.click();
    await expect(roomPage.editorRotLabel).toContainText('90° (West)');
    await roomPage.btnEditorRotate.click();
    await expect(roomPage.editorRotLabel).toContainText('180° (North)');

    // Rotate via hotkey 'R': 180° -> 270° -> 0°
    await page.keyboard.press('r');
    await expect(roomPage.editorRotLabel).toContainText('270° (East)');
    await page.keyboard.press('r');
    await expect(roomPage.editorRotLabel).toContainText('0° (South)');

    // 6. Exit Decorator Mode
    await roomPage.btnCloseEditor.click();
    await expect(roomPage.roomEditorInventory).not.toBeVisible();
  });
});
