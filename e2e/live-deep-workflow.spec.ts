import { test, expect } from '@playwright/test';

const PROD_URL = 'https://havenworld-game.pages.dev';

test.describe('Deep Real E2E Workflow Tests - Resolution, Click-to-Move, Decorator & Furniture', () => {
  test.use({
    viewport: { width: 1920, height: 1080 },
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      const txt = msg.text();
      if (txt.includes('[RoomEditor]') || txt.includes('[HavenEngine]') || txt.includes('[FurnitureManager]') || txt.includes('error')) {
        console.log(`[BROWSER] ${msg.type().toUpperCase()}: ${txt}`);
      }
    });
  });

  test('Full E2E: Resolution 1080p, Click-to-Move, Furniture Move/Rotate/Save, and Persistence', async ({ page }) => {
    test.setTimeout(180_000);

    // ── 1. Navigate and Log In ───────────────────────────────────────────────
    console.log('Navigating to HavenWorld production:', PROD_URL);
    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded' });

    const loginPanel = page.locator('#login-panel');
    await expect(loginPanel).toBeVisible({ timeout: 15_000 });

    await page.locator('#login-email').fill('testalpha@havenworld.dev');
    await page.locator('#login-password').fill('HavenAlpha2026!');
    await page.locator('#login-submit').click();

    // Verify login panel disappears and game-container is active
    await expect(loginPanel).not.toBeVisible({ timeout: 20_000 });
    const gameContainer = page.locator('#game-container');
    await expect(gameContainer).toBeVisible({ timeout: 20_000 });

    const canvas = page.locator('#haven-canvas');
    await expect(canvas).toBeVisible({ timeout: 20_000 });

    // Wait for room scene & avatar controller initialization
    await page.waitForFunction(() => {
      return (window as any).__havenActiveScene && (window as any).__havenAvatarController;
    }, { timeout: 20_000 });

    // Allow meshes and textures to stabilize
    await page.waitForTimeout(2000);

    // ── 2. Screen Resolution & HiDPI Validation (No 240p blur) ───────────────
    console.log('Validating screen rendering resolution...');
    const resolution = await page.evaluate(() => {
      const cvs = document.getElementById('haven-canvas') as HTMLCanvasElement;
      return {
        clientWidth: cvs.clientWidth,
        clientHeight: cvs.clientHeight,
        internalWidth: cvs.width,
        internalHeight: cvs.height,
        dpr: window.devicePixelRatio || 1,
      };
    });

    console.log('Measured Resolution:', resolution);
    // Real assertion: Internal rendering resolution MUST be at least 1280x720 (720p/1080p), NOT 300x150
    expect(resolution.internalWidth).toBeGreaterThanOrEqual(1280);
    expect(resolution.internalHeight).toBeGreaterThanOrEqual(720);
    expect(resolution.clientWidth).toBeGreaterThanOrEqual(1280);
    expect(resolution.clientHeight).toBeGreaterThanOrEqual(720);

    await page.screenshot({ path: 'screenshots/workflow-1-crisp-1080p-room.png' });
    console.log('✓ Resolution validation passed: Crisp HD rendering confirmed!');

    // ── 3. Click-to-Move Avatar Validation ──────────────────────────────────
    console.log('Validating click-to-move avatar pathfinding...');
    const startPos = await page.evaluate(() => {
      const ctrl = (window as any).__havenAvatarController;
      return { x: ctrl.position.x, y: ctrl.position.y, z: ctrl.position.z };
    });
    console.log('Initial Avatar Position:', startPos);

    // Click near center-right of the floor
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const targetClickX = box!.x + box!.width * 0.65;
    const targetClickY = box!.y + box!.height * 0.6;

    console.log(`Clicking floor at (${targetClickX}, ${targetClickY})...`);
    await page.mouse.click(targetClickX, targetClickY);

    // Wait for avatar controller to pathfind and update position
    await page.waitForFunction((initial) => {
      const ctrl = (window as any).__havenAvatarController;
      if (!ctrl) return false;
      const dx = ctrl.position.x - initial.x;
      const dz = ctrl.position.z - initial.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      return distance > 0.4;
    }, startPos, { timeout: 10_000 });

    const endPos = await page.evaluate(() => {
      const ctrl = (window as any).__havenAvatarController;
      return { x: ctrl.position.x, y: ctrl.position.y, z: ctrl.position.z };
    });
    console.log('End Avatar Position after click-to-move:', endPos);

    const distMoved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
    expect(distMoved).toBeGreaterThan(0.4);
    await page.screenshot({ path: 'screenshots/workflow-2-avatar-moved.png' });
    console.log(`✓ Click-to-move validation passed: Avatar moved ${distMoved.toFixed(2)}m across floor!`);

    // ── 4. Decorator Mode & Live Inventory Panel Validation ───────────────────
    console.log('Opening Decorator mode...');
    const btnDecorate = page.locator('#btn-decorate');
    await expect(btnDecorate).toBeVisible({ timeout: 5_000 });
    await btnDecorate.click();

    const inventoryPanel = page.locator('#room-editor-inventory');
    await expect(inventoryPanel).toBeVisible({ timeout: 5_000 });

    // Verify inventory loaded real items from /api/users/me/inventory
    const itemButtons = page.locator('.editor-inventory-item-btn');
    await expect(itemButtons.first()).toBeVisible({ timeout: 10_000 });
    const itemCount = await itemButtons.count();
    console.log(`Loaded ${itemCount} furniture item types in decorator panel.`);
    expect(itemCount).toBeGreaterThan(0);

    await page.screenshot({ path: 'screenshots/workflow-3-decorator-panel.png' });

    // ── 5. Place, Select, Rotate & Move Furniture ────────────────────────────
    console.log('Selecting furniture item to place in room...');
    const firstItemBtn = itemButtons.first();
    const itemIdPlaced = await firstItemBtn.getAttribute('data-item-id') || 'furniture-chair';
    await firstItemBtn.click();

    // Move cursor over canvas to position ghost mesh
    await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.5);
    await page.waitForTimeout(500);

    // Click floor to place the item
    console.log('Placing furniture item on floor...');
    await page.mouse.click(box!.x + box!.width * 0.45, box!.y + box!.height * 0.5);
    await page.waitForTimeout(800);

    // Verify item is placed in FurnitureManager
    const placedCount = await page.evaluate(() => {
      const fm = (window as any).__havenFurnitureManager;
      return fm ? fm.allPlaced.size : 0;
    });
    console.log(`Placed items in room: ${placedCount}`);
    expect(placedCount).toBeGreaterThan(0);

    // The selected toolbar appears immediately upon placement
    const selectedToolbar = page.locator('#furniture-selected-toolbar');
    await expect(selectedToolbar).toBeVisible({ timeout: 5_000 });

    // Rotate the item 90 degrees using the toolbar
    console.log('Testing Rotate 90° button on toolbar...');
    const rotateBtn = page.locator('#btn-furniture-rotate');
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();
    await page.waitForTimeout(500);

    // Test Pick Up & Move
    console.log('Testing ✋ Move button on toolbar...');
    const moveBtn = page.locator('#btn-furniture-move');
    await expect(moveBtn).toBeVisible();
    await moveBtn.click();
    await expect(selectedToolbar).not.toBeVisible();

    // Click at a new location to set the new position
    console.log('Placing at new repositioned location...');
    const newTargetX = box!.x + box!.width * 0.52;
    const newTargetY = box!.y + box!.height * 0.48;
    await page.mouse.move(newTargetX, newTargetY);
    await page.waitForTimeout(500);
    await page.mouse.click(newTargetX, newTargetY);
    await page.waitForTimeout(800);

    await page.screenshot({ path: 'screenshots/workflow-4-furniture-placed-and-moved.png' });

    // ── 6. Save Room Layout to Server ────────────────────────────────────────
    console.log('Saving room layout to backend database...');
    const savePromise = page.waitForResponse((res) => {
      return res.url().includes('/furniture/layout') && res.request().method() === 'POST';
    });

    const btnSaveLayout = page.locator('#btn-save-layout');
    await expect(btnSaveLayout).toBeVisible();
    await btnSaveLayout.click();

    const saveResponse = await savePromise;
    console.log(`Server responded to POST /furniture/layout with status: ${saveResponse.status()}`);
    expect(saveResponse.status()).toBe(200);

    const saveResult = await saveResponse.json();
    console.log('Layout Save Result:', saveResult);
    expect(saveResult.success).toBe(true);

    // Verify Toast notification was displayed
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    const toastText = await toast.textContent();
    expect(toastText).toContain('Room layout saved');
    console.log(`✓ Toast confirmed: "${toastText}"`);

    // Decorator panel should now be dismissed
    await expect(inventoryPanel).not.toBeVisible();

    // ── 7. Persistence Verification on Reload ────────────────────────────────
    console.log('Reloading page to verify persistence in database...');
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for auto-login / token restore & room load
    await page.waitForFunction(() => {
      return (window as any).__havenActiveScene && (window as any).__havenFurnitureManager;
    }, { timeout: 25_000 });

    await page.waitForTimeout(3000);

    const reloadedPlacedCount = await page.evaluate(() => {
      const fm = (window as any).__havenFurnitureManager;
      return fm ? fm.allPlaced.size : 0;
    });

    console.log(`After reload, room furniture count: ${reloadedPlacedCount}`);
    expect(reloadedPlacedCount).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: 'screenshots/workflow-5-persisted-layout.png' });
    console.log('✓ Persistence confirmed: Room layout persisted across full page reload!');
  });
});
