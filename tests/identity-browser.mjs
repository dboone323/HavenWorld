import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatResidency } from '../src/client/shared/identity.js';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-identity-')), 'test.db');
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
  const signup = await fetch(`${url}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ResidencyTest', password: 'test-only-password' })
  }).then(response => response.json());
  assert.equal(signup.success, true);
  const original = await db.getRegistrationDate(signup.playerId);
  assert.ok(Number.isFinite(Date.parse(original)));
  await page.addInitScript(id => localStorage.setItem('haven_token', id), signup.playerId);
  const frames = [];
  page.on('websocket', socket => socket.on('framereceived', event => {
    const message = JSON.parse(String(event.payload));
    if (message.type === 'INIT_STATE') frames.push(message.payload.player);
  }));
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#viewport'));
    await page.waitForTimeout(300);
    const guest = page.locator('#btn-welcome-guest');
    if (await guest.isVisible()) await guest.click();
    await page.locator('#btn-passport').click();
    await page.waitForFunction(() => document.querySelector('#passport-residency')?.textContent.startsWith('Resident since:'));
    assert.equal(await page.locator('#passport-residency').textContent(), formatResidency(original));
    assert.equal(frames.at(-1).registeredAt, original);
    assert.equal(frames.at(-1).isRegistered, true);
    await db.initPlayerProfile(signup.playerId, signup.name);
    await db.savePlayerName(signup.playerId, signup.name);
    assert.equal(await db.getRegistrationDate(signup.playerId), original);
  }
  await page.locator('#btn-close-passport').click();
  await page.locator('#btn-avatar').click();
  await page.locator('#wardrobe-shirtStyle').selectOption('hoodie');
  await page.locator('#wardrobe-shoesStyle').selectOption('boots');
  await page.locator('#wardrobe-shirtColor').fill('#123456');
  await page.locator('#wardrobe-shirtColor').press('Tab');
  const outfitPixels = await page.locator('#avatar-preview').evaluate(canvas => canvas.toDataURL());
  await page.locator('#preset-save-0').click();
  await page.waitForFunction(() => !document.querySelector('#preset-apply-0').disabled);
  await page.locator('#btn-save-avatar').click();
  await page.waitForFunction(() => document.querySelector('#avatar-modal').classList.contains('hidden'));
  // Wait for the server's durable outfit, not just the optimistic local preview.
  for (let i = 0; i < 50; i++) {
    if ((await db.loadIdentity(signup.playerId)).outfit?.shirtColor === '#123456') break;
    await page.waitForTimeout(50);
  }
  assert.equal((await db.loadIdentity(signup.playerId)).outfit.shirtColor, '#123456');
  await page.reload();
  await page.waitForTimeout(300);
  await page.locator('#btn-avatar').click();
  await page.waitForFunction(() => document.querySelector('#wardrobe-shirtStyle').value === 'hoodie');
  assert.equal(await page.locator('#wardrobe-shirtColor').inputValue(), '#123456');
  assert.equal(await page.locator('#wardrobe-shoesStyle').inputValue(), 'boots');
  assert.equal(await page.locator('#avatar-preview').evaluate(canvas => canvas.toDataURL()), outfitPixels);
  await page.locator('#wardrobe-shirtStyle').selectOption('dress');
  await page.locator('#preset-apply-0').click();
  await page.waitForFunction(() => document.querySelector('#wardrobe-shirtStyle').value === 'hoodie');
  assert.equal(await page.locator('#wardrobe-shirtColor').inputValue(), '#123456');
  assert.deepEqual(errors, []);
  console.log('PASS: create account → customize/equip → save preset → reconnect → verify DOM and canvas → apply preset; immutable residency');
} finally {
  await browser?.close();
  for (const client of wss.clients) client.terminate();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
  db.close();
}
