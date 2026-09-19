import { test, expect } from '@playwright/test';

test.describe('Live Production Thorough Functional & UI Audit', () => {
  test('Complete interactive walkthrough of HavenWorld live production', async ({ page }) => {
    test.setTimeout(120000);

    const consoleMessages: Array<{ type: string; text: string }> = [];
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error(`[PAGE UNCAUGHT ERROR] ${err.message}`);
    });

    console.log('1. Navigating to live production: https://havenworld-game.pages.dev');
    await page.goto('https://havenworld-game.pages.dev', { waitUntil: 'networkidle' });

    // Verify login panel visible
    await expect(page.locator('#login-panel')).toBeVisible({ timeout: 15000 });
    console.log('✓ Login panel rendered cleanly.');

    // Take screenshot of login panel
    await page.screenshot({ path: 'test-results/audit-1-login.png' });

    // Fill credentials
    console.log('2. Submitting login credentials for testalpha@havenworld.dev...');
    await page.fill('#login-email', 'testalpha@havenworld.dev');
    await page.fill('#login-password', 'HavenAlpha2026!');
    await page.click('#login-submit');

    // Wait for room scene to load
    await expect(page.locator('#game-container')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('#room-nav')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('#player-card')).toBeVisible({ timeout: 25000 });
    console.log('✓ Login successful! Successfully transitioned into 3D scene.');

    // Wait for Babylon canvas to stabilize
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'test-results/audit-2-room-loaded.png' });

    // 3. Verify coin balance indicator
    const coinEl = page.locator('#coin-amount');
    await expect(coinEl).toBeVisible();
    const coinText = await coinEl.textContent();
    console.log(`✓ Coin balance indicator visible. Current coins: ${coinText}`);

    // 4. Test Top Navigation Buttons
    const buttonsToTest = [
      { id: '#btn-workshop', name: 'Workshop', panelSelector: '#workshop-modal-overlay', closeSelector: '#workshop-panel-close' },
      { id: '#btn-pets', name: 'Pets', panelSelector: '#pet-modal-overlay', closeSelector: '#pet-panel-close' },
      { id: '#btn-clubs', name: 'Clubs', panelSelector: '#club-modal-overlay', closeSelector: '#club-panel-close' },
      { id: '#btn-gallery', name: 'Gallery', panelSelector: '#gallery-modal-overlay', closeSelector: '#gallery-panel-close' },
      { id: '#btn-shop', name: 'Emporium', panelSelector: '#shop-modal-overlay', closeSelector: '#btn-close-shop' },
      { id: '#btn-passport', name: 'Passport', panelSelector: '#passport-modal-overlay', closeSelector: '#btn-close-passport' },
      { id: '#btn-pizza', name: 'Pizza Chef', panelSelector: '#pizza-scene-overlay', closeSelector: '#btn-close-pizza' },
      { id: '#btn-avatar', name: 'Wardrobe', panelSelector: '#avatar-customizer', closeSelector: 'button:has-text("Cancel")' },
    ];

    for (const btn of buttonsToTest) {
      console.log(`Testing button: ${btn.name} (${btn.id})...`);
      const btnLocator = page.locator(btn.id);
      if (await btnLocator.isVisible()) {
        await btnLocator.click();
        await page.waitForTimeout(1000);

        // Capture screenshot of the opened panel
        const safeName = btn.name.toLowerCase().replace(/\s+/g, '-');
        await page.screenshot({ path: `test-results/audit-panel-${safeName}.png` });

        // Try to close modal
        const closeBtn = page.locator(`${btn.panelSelector} ${btn.closeSelector}, ${btn.panelSelector} button:has-text("✕"), ${btn.panelSelector} button:has-text("Cancel"), ${btn.closeSelector}`);
        if (await closeBtn.count() > 0 && await closeBtn.first().isVisible()) {
          await closeBtn.first().click();
        } else {
          // If overlay exists, click outside backdrop
          const overlay = page.locator(btn.panelSelector);
          if (await overlay.isVisible()) {
            await overlay.click({ position: { x: 10, y: 10 } });
          }
        }
        await page.waitForTimeout(500);
        console.log(`✓ ${btn.name} tested.`);
      } else {
        console.log(`Notice: ${btn.name} not visible in this room state.`);
      }
    }

    // 5. Test 3D canvas interaction (clicking on ground to move)
    console.log('5. Clicking on 3D canvas to test movement...');
    const canvas = page.locator('#haven-canvas');
    await canvas.click({ position: { x: 400, y: 400 } });
    await page.waitForTimeout(1500);
    await canvas.click({ position: { x: 500, y: 350 } });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/audit-3-after-movement.png' });
    console.log('✓ Canvas movement interaction tested.');

    // 6. Test Chat functionality
    console.log('6. Testing in-game chat...');
    const chatInput = page.locator('#chat-input');
    if (await chatInput.isVisible()) {
      await chatInput.fill('Hello HavenWorld audit!');
      await page.locator('#chat-send').click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/audit-4-chat.png' });
      console.log('✓ Chat message sent.');
    }

    // 7. Test Fast Travel (Haven Park vs My Loft)
    console.log('7. Testing fast travel navigation...');
    const btnPark = page.locator('#btn-park');
    if (await btnPark.isVisible()) {
      await btnPark.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: 'test-results/audit-5-haven-park.png' });
      console.log('✓ Traveled to Haven Park.');
    }

    // Summary of page errors
    console.log('\n--- AUDIT CONSOLE SUMMARY ---');
    console.log(`Uncaught JS Errors: ${pageErrors.length}`);
    if (pageErrors.length > 0) {
      pageErrors.forEach((e) => console.log('  Error:', e));
    }

    const errorsInConsole = consoleMessages.filter((m) => m.type === 'error');
    console.log(`Console Errors: ${errorsInConsole.length}`);
    errorsInConsole.forEach((m) => console.log('  [Console Error]:', m.text));
  });
});
