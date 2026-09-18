import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-loft-browser-')), 'test.db');
process.env.HAVEN_NO_TICK = '1';

const { server, wss, db } = await import('../src/server/server.ts');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#viewport'));
  await page.waitForTimeout(300);

  // 1. Verify Top Bar UI Elements
  const gemCounter = page.locator('#gem-counter');
  assert.ok(await gemCounter.isVisible(), 'Gem counter pill should be visible in header');

  const btnMarket = page.locator('#btn-marketplace');
  assert.ok(await btnMarket.isVisible(), 'Marketplace button should be visible in header');

  const btnCraft = page.locator('#btn-crafting');
  assert.ok(await btnCraft.isVisible(), 'Workshop button should be visible in header');

  const btnLoft = page.locator('#btn-loft-settings');
  assert.ok(await btnLoft.isVisible(), 'Loft settings button should be visible in header');

  // 2. Open Edit Palette & Test 4-Way Rotation
  const btnEdit = page.locator('#btn-edit-mode');
  await btnEdit.click();
  await page.waitForTimeout(200);

  const rotLabel = page.locator('#current-rot-label');
  const btnRotate = page.locator('#btn-rotate-furni');
  assert.equal(await rotLabel.textContent(), '0° (South)');

  // Click rotate button: 0 -> 90 -> 180 -> 270 -> 0
  await btnRotate.click();
  assert.equal(await rotLabel.textContent(), '90° (West)');

  await btnRotate.click();
  assert.equal(await rotLabel.textContent(), '180° (North)');

  await btnRotate.click();
  assert.equal(await rotLabel.textContent(), '270° (East)');

  await btnRotate.click();
  assert.equal(await rotLabel.textContent(), '0° (South)');

  // Keyboard 'r' shortcut rotation
  await page.keyboard.press('KeyR');
  assert.equal(await rotLabel.textContent(), '90° (West)');

  // Close Decorator Palette
  await page.locator('#btn-close-decor').click();
  await page.waitForFunction(() => document.querySelector('#decor-palette').classList.contains('hidden'));

  // 3. Test Loft Settings Modal
  await btnLoft.click();
  await page.waitForFunction(() => !document.querySelector('#loft-settings-modal').classList.contains('hidden'));
  const currentSize = await page.locator('#loft-current-size').textContent();
  assert.ok(currentSize.includes('Tiles'), 'Should display room grid size');
  await page.locator('#btn-close-loft-settings').click();
  await page.waitForFunction(() => document.querySelector('#loft-settings-modal').classList.contains('hidden'));

  // 4. Test Marketplace Modal
  await btnMarket.click();
  await page.waitForFunction(() => !document.querySelector('#marketplace-modal').classList.contains('hidden'));
  // Switch to Sell tab
  await page.locator('#tab-market-sell').click();
  await page.waitForFunction(() => !document.querySelector('#market-sell-panel').classList.contains('hidden'));
  // Switch back to Browse tab
  await page.locator('#tab-market-browse').click();
  await page.waitForFunction(() => !document.querySelector('#market-browse-panel').classList.contains('hidden'));
  await page.locator('#btn-close-marketplace').click();
  await page.waitForFunction(() => document.querySelector('#marketplace-modal').classList.contains('hidden'));

  // 5. Test Workshop & Crafting Modal
  await btnCraft.click();
  await page.waitForFunction(() => !document.querySelector('#crafting-modal').classList.contains('hidden'));
  // Verify recipes are rendered
  const recipesCount = await page.locator('#workshop-recipes-list .recipe-card').count();
  assert.ok(recipesCount >= 4, `Expected at least 4 workshop recipes, found ${recipesCount}`);
  // Switch to Dismantle tab
  await page.locator('#tab-craft-recycle').click();
  await page.waitForFunction(() => !document.querySelector('#craft-recycle-panel').classList.contains('hidden'));
  await page.locator('#btn-close-crafting').click();
  await page.waitForFunction(() => document.querySelector('#crafting-modal').classList.contains('hidden'));

  assert.equal(errors.length, 0, `Browser errors detected: ${errors.join('; ')}`);
  console.log('✅ Browser Loft & Economy integration test passed successfully!');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
