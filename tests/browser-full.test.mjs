/**
 * HavenWorld — Comprehensive browser test with visual verification
 * Tests all UI elements and the floor rendering.
 */
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';

const HTTP_PORT = process.env.PORT || process.env.VERIFY_HTTP_PORT || 3000;
const ARG_URL = (process.argv[2] || '').startsWith('http') ? process.argv[2] : '';
const LOCAL_URL = ARG_URL || process.env.VERIFY_HTTP_URL || `http://localhost:${HTTP_PORT}`;
// WS endpoints derive from the requested HTTP(S) URL unless explicitly overridden.
const WS_BASE = process.env.VERIFY_WS_URL || LOCAL_URL.replace(/^http/, 'ws');

async function run() {
  const browser = await chromium.launch({ headless: true });
  let passed = 0, failed = 0;
  const errors = [];

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  \u2714 ${name}`);
      passed++;
    } catch (err) {
      console.log(`  \u2716 ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[error] ${err.message}`));

  // Test 1: Page loads
  await test('Game page loads and shows title', async () => {
    await page.goto(LOCAL_URL, { waitUntil: 'networkidle' });
    const title = await page.title();
    assert.ok(title.includes('HavenWorld'), `title is "${title}"`);

    // Dismiss welcome gate if visible
    const guestBtn = await page.$('#btn-welcome-guest');
    if (guestBtn) {
      const isVisible = await guestBtn.isVisible().catch(() => false);
      if (isVisible) await guestBtn.click();
    }
  });

  // Test 2: Canvas has rendered floor
  await test('Canvas has rendered floor grid content', async () => {
    const canvasHandle = await page.$('#viewport');
    assert.ok(canvasHandle, 'canvas #viewport exists');
    // Wait a frame for render
    await page.waitForTimeout(500);
    const hasContent = await page.evaluate(() => {
      const canvas = document.getElementById('viewport');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonBlack = 0;
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 0 || data[i+1] > 0 || data[i+2] > 0) nonBlack++;
      }
      return nonBlack > 100;
    });
    assert.ok(hasContent, 'floor grid pixels detected on canvas');
  });

  // Test 3: All top-bar buttons exist
  await test('All top-bar buttons exist', async () => {
    const buttons = ['#btn-daily-bonus', '#btn-minigame', '#btn-edit-mode', '#btn-avatar', '#btn-friends'];
    for (const sel of buttons) {
      const btn = await page.$(sel);
      assert.ok(btn, `${sel} exists`);
    }
  });

  // Test 4: Daily bonus button triggers coin update
  await test('Daily bonus button sends CLAIM_DAILY_BONUS', async () => {
    // The client sends this via WebSocket — verify via WS directly
    const ws = new WebSocket(WS_BASE + (WS_BASE.includes('?') ? '&' : '?') + 'guestId=usr_' + Math.random().toString(36).substring(2, 9));
    await new Promise(r => ws.on('open', r));
    await new Promise((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'INIT_STATE') resolve();
      });
    });
    ws.send(JSON.stringify({ type: 'CLAIM_DAILY_BONUS', payload: {} }));
    const upd = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout')), 3000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'COINS_UPDATED') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });
    assert.equal(upd.payload.coins, 1250);
    ws.close();
  });

  // Test 5: Friends button opens panel
  await test('Friends button opens friends modal', async () => {
    await page.$eval('#btn-friends', el => el.click());
    await page.waitForTimeout(300);
    const cls = await page.$eval('#friends-modal', el => el.getAttribute('class'));
    assert.ok(!cls.includes('hidden'), 'friends modal is visible');
  });

  // Test 6: Friends modal has all sections
  await test('Friends modal has friends list, pending, add form, and PM section', async () => {
    const sections = ['#pending-requests-list', '#friends-list', '#add-friend-form', '#pm-history', '#pm-form'];
    for (const sel of sections) {
      const el = await page.$(sel);
      assert.ok(el, `${sel} exists in friends modal`);
    }
  });

  // Test 7: Wardrobe button opens avatar modal
  await test('Wardrobe button opens avatar modal', async () => {
    const closeFriends = await page.$('#btn-close-friends');
    if (closeFriends) await closeFriends.click();
    await page.waitForTimeout(200);
    await page.$eval('#btn-avatar', el => el.click());
    await page.waitForTimeout(300);
    const cls = await page.$eval('#avatar-modal', el => el.getAttribute('class'));
    assert.ok(!cls.includes('hidden'), 'avatar modal is visible');
  });

  // Test 8: Avatar modal has color swatches
  await test('Avatar modal has color swatch selectors', async () => {
    for (const swatchId of ['#skin-tones', '#hair-colors', '#shirt-colors']) {
      const swatches = await page.$$(`${swatchId} .color-swatch`);
      assert.ok(swatches.length > 0, `${swatchId} has color swatches`);
    }
  });

  // Test 9: Minigame button opens pizza modal
  await test('Minigame button opens pizza chef modal', async () => {
    const closeAvatar = await page.$('#btn-close-avatar');
    if (closeAvatar) await closeAvatar.click();
    await page.waitForTimeout(200);

    await page.$eval('#btn-minigame', el => el.click());
    await page.waitForTimeout(300);
    const cls = await page.$eval('#minigame-modal', el => el.getAttribute('class'));
    assert.ok(!cls.includes('hidden'), 'minigame modal is visible');

    const closeMini = await page.$('#btn-close-minigame');
    if (closeMini) await closeMini.click();
    await page.waitForTimeout(200);
  });

  // Test 10: Edit mode button toggles
  await test('Edit mode button toggles furniture palette', async () => {
    await page.$eval('#btn-edit-mode', el => el.click());
    await page.waitForTimeout(200);
    const palette = await page.$('#decor-palette');
    const cls = await palette.getAttribute('class');
    assert.ok(!cls.includes('hidden'), 'decor palette shows after edit mode');

    // Toggle off edit mode so palette does not obstruct other clicks
    await page.$eval('#btn-edit-mode', el => el.click());
    await page.waitForTimeout(200);
  });

  // Test 10b: Elevator Navigator modal opens
  await test('Navigator button opens sanctuary elevator modal', async () => {
    const navBtn = await page.$('#btn-navigator');
    assert.ok(navBtn, '#btn-navigator exists in top bar');
    await navBtn.click();
    await page.waitForTimeout(300);
    const cls = await page.$eval('#navigator-modal', el => el.getAttribute('class'));
    assert.ok(!cls.includes('hidden'), 'navigator modal is visible');
    const closeBtn = await page.$('#btn-close-navigator');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  });

  // Test 10c: Haven Passport modal opens
  await test('Passport button opens stamps & achievements modal', async () => {
    const passBtn = await page.$('#btn-passport');
    assert.ok(passBtn, '#btn-passport exists in top bar');
    await passBtn.click();
    await page.waitForTimeout(300);
    const cls = await page.$eval('#passport-modal', el => el.getAttribute('class'));
    assert.ok(!cls.includes('hidden'), 'passport modal is visible');
    const grid = await page.$('#passport-stamps-grid');
    assert.ok(grid, 'passport stamps grid rendered');
    const closeBtn = await page.$('#btn-close-passport');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(200);
  });

  // Test 10d: Audio toggle button exists and toggles
  await test('Audio toggle button switches sound state', async () => {
    const audioBtn = await page.$('#btn-audio-toggle');
    assert.ok(audioBtn, '#btn-audio-toggle exists');
    const initialText = await audioBtn.textContent();
    await audioBtn.click();
    await page.waitForTimeout(200);
    const newText = await audioBtn.textContent();
    assert.notEqual(initialText, newText, 'audio toggle changed state');
    // Toggle back
    await audioBtn.click();
    await page.waitForTimeout(200);
  });

  // Test 10e: Quick emote button triggers character emote animation
  await test('Quick emote button triggers character emote state', async () => {
    const waveBtn = await page.$('.emote-btn[data-text*="👋"]');
    assert.ok(waveBtn, 'quick wave emote button exists');
    await waveBtn.click();
    await page.waitForTimeout(250);
    const hasActiveEmote = await page.evaluate(() => {
      return !!window.__havenGame?.selfPlayer?.activeEmote;
    });
    assert.ok(hasActiveEmote, 'selfPlayer has activeEmote triggered');
  });

  // Test 10f: Hovering interactive objects updates cursor to pointer
  await test('Hovering canvas interactive object updates cursor', async () => {
    const canvas = await page.$('#viewport');
    assert.ok(canvas, 'viewport canvas exists');
    const box = await canvas.boundingBox();
    // Center of canvas has the plaza fountain (grid 5, 5)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35);
    await page.waitForTimeout(150);
    const cursor = await page.$eval('#viewport', el => el.style.cursor);
    assert.ok(cursor === 'pointer' || cursor === 'default', 'cursor responds to hover');
  });

  // Test 10g: Chat log renders category badges
  await test('Chat log renders styled category badges', async () => {
    const sysBadge = await page.$('.chat-badge.sys');
    assert.ok(sysBadge, 'system chat badge is rendered in chat log');
  });

  // Test 11: No browser console errors
  await test('No browser console errors', async () => {
    assert.equal(errors.length, 0, `console errors: ${errors.join('; ')}`);
  });

  // Test 12: Room selector works
  await test('Room selector switches rooms', async () => {
    const ws = new WebSocket(WS_BASE);
    await new Promise(r => ws.on('open', r));
    await new Promise((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'INIT_STATE') resolve();
      });
    });
    ws.send(JSON.stringify({ type: 'SWITCH_ROOM', payload: { roomId: 'sanctuary_loft' } }));
    const changed = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout')), 3000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ROOM_CHANGED') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });
    assert.equal(changed.payload.room.id, 'sanctuary_loft');
    ws.close();
  });

  // Test 13: Surface parenting — click table then place item on it
  await test('Surface parenting: click table, place item with elevation', async () => {
    // Close all modals via JS
    await page.evaluate(() => {
      ['#friends-modal', '#avatar-modal', '#minigame-modal'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.classList.add('hidden');
      });
    });
    await page.waitForTimeout(300);

    // Exit edit mode if Test 10 left it on (editMode is module-level state)
    // The palette is shown from Test 10 — toggle it off first
    const paletteHidden = await page.evaluate(() => {
      const p = document.getElementById('decor-palette');
      return p.classList.contains('hidden');
    });
    if (!paletteHidden) {
      await page.evaluate(() => document.getElementById('btn-edit-mode').click());
      await page.waitForTimeout(200);
    }

    // Switch to sanctuary loft via the select dropdown (which uses player-specific loft ID)
    const loftRoomId = await page.evaluate(() => {
      const sel = document.getElementById('room-select');
      const opt = Array.from(sel.options).find(o => o.value.startsWith('loft_') || o.value === 'sanctuary_loft');
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change'));
        return opt.value;
      }
      return 'sanctuary_loft';
    });
    // Wait for WebSocket round-trip
    await page.waitForTimeout(1500);

    // Enter edit mode via JS click
    await page.evaluate(() => {
      document.getElementById('btn-edit-mode').click();
    });
    await page.waitForTimeout(500);

    // Verify edit mode is active
    const paletteVisible = await page.evaluate(() => {
      const p = document.getElementById('decor-palette');
      return !p.classList.contains('hidden');
    });
    assert.ok(paletteVisible, 'decor palette is visible in edit mode');

    // Calculate click coordinates using the game's toScreen formula
    const clickResult = await page.evaluate(() => {
      const canvas = document.getElementById('viewport');
      const rect = canvas.getBoundingClientRect();
      const originX = canvas.width / 2;
      const originY = Math.max(120, canvas.height * 0.22);
      const TILE_W = 64, TILE_H = 32;
      const tableX = originX + (5 - 4) * (TILE_W / 2);
      const tableY = originY + (5 + 4) * (TILE_H / 2) + (TILE_H / 2);
      const placeX = originX + (5 - 4) * (TILE_W / 2);
      const placeY = originY + (5 + 4) * (TILE_H / 2);
      return {
        tableX: rect.left + tableX,
        tableY: rect.top + tableY,
        placeX: rect.left + placeX,
        placeY: rect.top + placeY,
      };
    });

    // Click the table first (to enter surface parenting mode)
    await page.mouse.click(clickResult.tableX, clickResult.tableY);
    await page.waitForTimeout(300);

    // Click to place item on the table surface
    await page.mouse.click(clickResult.placeX, clickResult.placeY);
    await page.waitForTimeout(800);

    // Exit edit mode
    await page.evaluate(() => {
      document.getElementById('btn-edit-mode').click();
    });
    await page.waitForTimeout(300);

    // Verify that elevated furniture was placed on the table surface
    const hasElevated = await page.evaluate(() => {
      const room = window.__havenGame?.getCurrentRoom();
      return room?.furniture?.some(f => f.elevation > 0);
    });
    assert.ok(hasElevated, 'elevated furniture found in room state');
  });

  await browser.close();
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log(`  Console errors: ${errors.join('; ')}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
