const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = '/Users/danielstevens/.gemini/antigravity/brain/98772a0b-e303-46e0-a01b-49806d7328e0';

async function verify() {
  console.log('Launching headless browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log('Navigating to live production https://havenworld-game.pages.dev...');
  await page.goto('https://havenworld-game.pages.dev', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Sign in with the user we just created
  console.log('Signing in with chibi_05442...');
  await page.fill('#login-email', 'chibi_05442');
  await page.fill('#login-password', 'ChibiTest123!');
  await page.click('#login-submit');

  console.log('Waiting for #game-container...');
  await page.waitForSelector('#game-container', { state: 'visible', timeout: 30000 });
  console.log('#game-container is visible!');

  await page.waitForTimeout(3000);

  // Dismiss daily reward if present
  try {
    const collectBtn = page.locator('button:has-text("Collect!")');
    if (await collectBtn.isVisible({ timeout: 2000 })) {
      console.log('Dismissing daily login reward modal...');
      await collectBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch {}

  // 1. Loft Screenshot with 2D Chibi
  const loftShot = path.join(ARTIFACT_DIR, 'live-production-chibi-loft.png');
  await page.screenshot({ path: loftShot });
  console.log('Saved clean loft screenshot to:', loftShot);

  // 2. Walk avatar by clicking floor to test movement and direction
  console.log('Clicking room floor to walk avatar...');
  await page.mouse.click(750, 480);
  await page.waitForTimeout(2000);

  const walkedShot = path.join(ARTIFACT_DIR, 'live-production-chibi-walked.png');
  await page.screenshot({ path: walkedShot });
  console.log('Saved walked screenshot to:', walkedShot);

  // 3. Open Wardrobe & Customization Modal
  console.log('Opening Wardrobe (#btn-avatar)...');
  const btnAvatar = page.locator('#btn-avatar');
  await btnAvatar.click();
  await page.waitForSelector('#avatar-customizer', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(2500); // Wait for preview scene to render

  const wardrobeShot = path.join(ARTIFACT_DIR, 'live-production-chibi-wardrobe.png');
  await page.screenshot({ path: wardrobeShot });
  console.log('Saved wardrobe customizer screenshot to:', wardrobeShot);

  await browser.close();
  console.log('Live production verification complete!');
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
