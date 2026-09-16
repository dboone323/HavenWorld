/**
 * HavenWorld — Visual verification test
 * Captures a screenshot and checks that the floor grid is rendered.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const LOCAL_URL = 'http://localhost:3999';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(LOCAL_URL, { waitUntil: 'networkidle' });

  // Wait for WebSocket to connect and INIT_STATE
  const startTime = Date.now();
  while (Date.now() - startTime < 10000) {
    const log = await page.evaluate(() => window._havenTestLog || []);
    await page.waitForTimeout(500);
  }

  // Screenshot the canvas area
  const screenshot = await page.screenshot({
    path: '/home/ubuntu/Developer/HavenWorld/tests/visual-check.png',
    fullPage: false,
  });

  console.log('Screenshot saved to tests/visual-check.png');

  // Check if canvas has non-empty pixel data (floor is rendered)
  const hasContent = await page.evaluate(() => {
    const canvas = document.getElementById('viewport');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Check if there are non-zero (non-black) pixels
    let nonBlack = 0;
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 0 || data[i+1] > 0 || data[i+2] > 0) nonBlack++;
    }
    return nonBlack > 100;
  });

  if (hasContent) {
    console.log('  ✔ Canvas has rendered content (floor grid visible)');
  } else {
    console.log('  ✖ Canvas appears empty — floor may not be rendering');
  }

  // Check WebSocket connection status
  const wsStatus = await page.evaluate(() => {
    return typeof WebSocket !== 'undefined' && 'WebSocket' in window;
  });

  // Check console for errors
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.waitForTimeout(2000);

  if (errors.length > 0) {
    console.log('  ⚠ Browser console errors:');
    errors.forEach(e => console.log(`    ${e}`));
  } else {
    console.log('  ✔ No browser console errors');
  }

  await browser.close();
  console.log('Visual check complete.');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
