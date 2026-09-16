/**
 * HavenWorld — Browser-level integration test
 * Verifies the game actually loads and renders in a real browser,
 * and that WebSocket multiplayer works.
 */
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';

const LOCAL_URL = 'http://localhost:3999';

// Dynamically read the current tunnel URL from the log file
// (the tunnel URL changes on each restart, so we must read the latest)
import { readFileSync } from 'node:fs';
let TUNNEL_URL = process.argv[2] || '';
if (!TUNNEL_URL) {
  try {
    const log = readFileSync('/home/ubuntu/havenworld-tunnel.log', 'utf-8');
    const matches = [...log.matchAll(/https:\/\/[a-z-]+\.trycloudflare\.com/g)];
    if (matches.length > 0) TUNNEL_URL = matches[matches.length - 1][0];
  } catch { /* log file not available yet */ }
}
if (!TUNNEL_URL) TUNNEL_URL = 'http://localhost:3999'; // fallback to local only

async function run() {
  const browser = await chromium.launch({ headless: true });
  let passed = 0, failed = 0;

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

  // Test 1: Game page loads
  await test('Game page loads and shows title', async () => {
    await page.goto(LOCAL_URL, { waitUntil: 'networkidle' });
    const title = await page.title();
    assert.ok(title.includes('HavenWorld'), `title is "${title}"`);
  });

  // Test 2: Canvas renders
  await test('Canvas element exists and has dimensions', async () => {
    const canvasHandle = await page.$('#viewport');
    assert.ok(canvasHandle, 'canvas #viewport exists');
    const boundingBox = await canvasHandle.boundingBox();
    assert.ok(boundingBox.width > 0 && boundingBox.height > 0, 'canvas has dimensions');
  });

  // Test 3: Friends button opens panel
  await test('Friends button exists and opens panel', async () => {
    const friendsBtn = await page.$('#btn-friends');
    assert.ok(friendsBtn, 'friends button exists');
    await friendsBtn.click();
    await page.waitForTimeout(300);
    const modal = await page.$('#friends-modal');
    const cls = await modal.getAttribute('class');
    assert.ok(!cls.includes('hidden'), 'friends modal opens');
  });

  // Test 4: Wardrobe button opens avatar modal
  await test('Wardrobe button exists and opens avatar modal', async () => {
    // Close friends modal first if open
    const closeFriends = await page.$('#btn-close-friends');
    if (closeFriends) await closeFriends.click();
    await page.waitForTimeout(200);
    const avatarBtn = await page.$('#btn-avatar');
    assert.ok(avatarBtn, 'avatar button exists');
    await avatarBtn.click();
    await page.waitForTimeout(300);
    const modal = await page.$('#avatar-modal');
    const cls = await modal.getAttribute('class');
    assert.ok(!cls.includes('hidden'), 'avatar modal opens');
  });

  // Test 5: WebSocket INIT_STATE
  await test('WebSocket INIT_STATE received', async () => {
    const ws = new WebSocket(`ws://localhost:3999`);
    const initMsg = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout waiting for INIT_STATE')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'INIT_STATE') {
          clearTimeout(to);
          resolve(msg);
        }
      });
      ws.on('error', reject);
    });
    assert.ok(initMsg.payload.selfId.startsWith('usr_'), 'selfId shape');
    assert.ok(initMsg.payload.room, 'room in INIT_STATE');
    assert.ok(Array.isArray(initMsg.payload.room.furniture), 'furniture array in room');
    assert.ok(initMsg.payload.room.furniture.length > 0, 'floor furniture present');
    ws.close();
  });

  // Test 6: Chat sends and receives
  await test('Chat sends and receives between two clients', async () => {
    const ws1 = new WebSocket(`ws://localhost:3999`);
    const ws2 = new WebSocket(`ws://localhost:3999`);
    await Promise.all([
      new Promise(r => ws1.on('open', r)),
      new Promise(r => ws2.on('open', r)),
    ]);
    await new Promise((resolve) => {
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'INIT_STATE') resolve();
      });
    });
    ws1.send(JSON.stringify({ type: 'CHAT', payload: { text: 'hello from test' } }));
    const chatMsg = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout waiting for CHAT_MESSAGE')), 3000);
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CHAT_MESSAGE') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });
    assert.equal(chatMsg.payload.text, 'hello from test');
    ws1.close();
    ws2.close();
  });

  // Test 7: Click-to-walk
  await test('MOVE sends PLAYER_MOVED with target coords', async () => {
    const ws = new WebSocket(`ws://localhost:3999`);
    await new Promise(r => ws.on('open', r));
    await new Promise((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'INIT_STATE') resolve();
      });
    });
    ws.send(JSON.stringify({ type: 'MOVE', payload: { x: 3, y: 4 } }));
    const movedMsg = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout waiting for PLAYER_MOVED')), 3000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PLAYER_MOVED') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });
    assert.equal(movedMsg.payload.targetX, 3);
    assert.equal(movedMsg.payload.targetY, 4);
    ws.close();
  });

  // Test 8: Room switch works
  await test('SWITCH_ROOM delivers ROOM_CHANGED', async () => {
    const ws = new WebSocket(`ws://localhost:3999`);
    await new Promise(r => ws.on('open', r));
    await new Promise((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'INIT_STATE') resolve();
      });
    });
    ws.send(JSON.stringify({ type: 'SWITCH_ROOM', payload: { roomId: 'sanctuary_loft' } }));
    const changedMsg = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout waiting for ROOM_CHANGED')), 3000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ROOM_CHANGED') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });
    assert.equal(changedMsg.payload.room.id, 'sanctuary_loft');
    ws.close();
  });

  // Test 9: Tunnel public accessibility
  const tunnelUrl = TUNNEL_URL;
  await test(`Tunnel URL is publicly reachable`, async () => {
    const tunnelPage = await browser.newPage();
    await tunnelPage.goto(tunnelUrl, { waitUntil: 'networkidle', timeout: 15000 });
    const title = await tunnelPage.title();
    assert.ok(title.includes('HavenWorld'), `tunnel title is "${title}"`);
    const canvas = await tunnelPage.$('#viewport');
    assert.ok(canvas, 'canvas exists on tunnel page');
    await tunnelPage.close();
  });

  // Test 10: WebSocket through tunnel (wss)
  await test(`WebSocket works over wss:// tunnel`, async () => {
    const wssUrl = tunnelUrl.replace('https://', 'wss://');
    const ws = new WebSocket(wssUrl);
    const initMsg = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout waiting for INIT_STATE over wss')), 10000);
      ws.on('open', () => {});
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'INIT_STATE') {
          clearTimeout(to);
          resolve(msg);
        }
      });
      ws.on('error', reject);
    });
    assert.ok(initMsg.payload.selfId.startsWith('usr_'), 'wss selfId');
    ws.close();
  });

  await browser.close();
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
