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

    // Apply a non-default mood and prove the Babylon ambient light changes.
    const ambientBefore = await page.evaluate(() => {
      const scene = (window as any).__havenActiveScene;
      const light = scene?.getLightByName?.('ambientLight');
      return light?.diffuse?.asArray?.() ?? null;
    });
    await page.locator('#mood-select').selectOption('night');
    await page.locator('#save-mood').click();
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const scene = (window as any).__havenActiveScene;
            const light = scene?.getLightByName?.('ambientLight');
            return light?.diffuse?.asArray?.() ?? null;
          }),
        { timeout: 10_000 }
      )
      .not.toEqual(ambientBefore);

    // Applying a mood intentionally closes the settings panel and shows a toast.
    await expect(roomPage.loftSettingsClose).not.toBeVisible();
    await expect(page.locator('.toast').last()).toContainText('Mood updated');

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

  test('Placing item from decorator HUD does not make the avatar walk', async ({ page }) => {
    const decoratorTs = Date.now().toString().slice(-6);
    const decoratorUser = {
      username: `dec_${decoratorTs}`,
      email: `dec_${decoratorTs}@havenworld.test`,
      password: 'Password123!',
    };
    const loginPage = new LoginPage(page);
    const roomPage = new RoomPage(page);

    await loginPage.goto();
    await loginPage.register(decoratorUser);
    await loginPage.verifyEmailViaTestRoute(decoratorUser.email);
    await loginPage.login(decoratorUser.email, decoratorUser.password);
    await roomPage.waitForRoomReady();

    // 1. Record avatar position before decorating
    const posBefore = await roomPage.getAvatarState();
    expect(posBefore).not.toBeNull();
    expect(posBefore!.isMoving).toBe(false);

    // 2. Open decorator mode
    await roomPage.btnDecorate.click();
    await expect(roomPage.roomEditorInventory).toBeVisible({ timeout: 5_000 });

    // 3. Click floor while in edit mode (without item selected)
    await roomPage.clickCanvas(480, 360);
    await page.waitForTimeout(400);

    // Avatar must remain unmoved
    const posDuringDecorate = await roomPage.getAvatarState();
    expect(posDuringDecorate!.x).toBe(posBefore!.x);
    expect(posDuringDecorate!.z).toBe(posBefore!.z);
    expect(posDuringDecorate!.isMoving).toBe(false);

    // 4. Start placing an item from ghost
    await page.evaluate(async () => {
      const editor = (window as any).__havenRoomEditor;
      if (editor) {
        await editor.startPlacement('furniture-chair-oak-01');
      }
    });

    // Click canvas to place the furniture
    await roomPage.clickCanvas(480, 360);
    await page.waitForTimeout(600);

    // Verify item was placed into the furniture manager
    const placedCount = await page.evaluate(() => {
      const editor = (window as any).__havenRoomEditor;
      return editor?.furnitureManager?.allPlaced?.size ?? 0;
    });
    expect(placedCount).toBeGreaterThan(0);

    // Avatar must STILL remain in place (never walk!)
    const posAfterPlacement = await roomPage.getAvatarState();
    expect(posAfterPlacement!.x).toBe(posBefore!.x);
    expect(posAfterPlacement!.z).toBe(posBefore!.z);
    expect(posAfterPlacement!.isMoving).toBe(false);

    // 5. Exit decorator mode
    await roomPage.btnCloseEditor.click();
    await expect(roomPage.roomEditorInventory).not.toBeVisible();

    // 6. Regular canvas click outside decorator mode should now move the avatar normally
    await roomPage.clickCanvas(480, 360);
    await page.waitForFunction(
      (startX) => {
        const fn = (window as any).__havenGetAvatarPosition;
        const state = typeof fn === 'function' ? fn() : null;
        return state && (state.isMoving === true || Math.abs(state.x - startX) > 0.05);
      },
      posBefore!.x,
      { timeout: 5_000 }
    );
    await roomPage.waitForAvatarArrival();
    const finalPos = await roomPage.getAvatarState();
    expect(finalPos!.isMoving).toBe(false);
    expect(Math.hypot(finalPos!.x - posBefore!.x, finalPos!.z - posBefore!.z)).toBeGreaterThan(0.2);
  });
});
