/**
 * HavenWorld — Standalone Integration Test Runner
 *
 * Runs end-to-end WebSocket integration tests without `node --test`, which
 * has a known issue with pending Promises when process.exit(0) is used in
 * after() hooks alongside an HTTP/WebSocket server on Node 26.
 *
 * Usage:   node tests/integration-runner.mjs
 */
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force an isolated SQLite store so no real Supabase credentials are needed.
process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-int-')), 'int.db');
process.env.PORT = '0';

const { server, wss, rooms, db } = await import(new URL('../src/server/server.ts', import.meta.url));

let port;
await new Promise(r => server.listen(0, () => {
  port = server.address().port;
  r();
}));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const msgs = [];
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('message', d => msgs.push(JSON.parse(d)));
    ws.on('error', reject);
  });
}

function settle(n = 50) { return new Promise(r => setTimeout(r, n)); }

let passed = 0;
let failed = 0;

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

// --- Integration Tests ---

await test('INIT_STATE is sent to each connecting client', async () => {
  const pam = await connect();
  const jim = await connect();
  await settle(60);
  assert.ok(pam.msgs.some(m => m.type === 'INIT_STATE'), 'pam got INIT_STATE');
  assert.ok(jim.msgs.some(m => m.type === 'INIT_STATE'), 'jim got INIT_STATE');
  const selfId = pam.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;
  assert.ok(selfId.startsWith('usr_'), 'selfId shape');
  pam.ws.close(); jim.ws.close();
  await settle(100);
});

await test('CHAT is broadcast to the other occupant', async () => {
  const pam = await connect(); const jim = await connect();
  await settle(50);
  const pamName = pam.msgs.find(m => m.type === 'INIT_STATE').payload.player.name;
  const before = jim.msgs.length;
  pam.ws.send(JSON.stringify({ type: 'CHAT', payload: { text: 'hello jim' } }));
  await settle(50);
  const chat = jim.msgs.slice(before).find(m => m.type === 'CHAT_MESSAGE');
  assert.ok(chat, 'jim received CHAT_MESSAGE');
  assert.equal(chat.payload.sender, pamName);
  assert.equal(chat.payload.text, 'hello jim');
  pam.ws.close(); jim.ws.close();
  await settle(100);
});

await test('MOVE is broadcast to the other occupant', async () => {
  const a = await connect(); const b = await connect();
  await settle(40);
  const before = b.msgs.length;
  a.ws.send(JSON.stringify({ type: 'MOVE', payload: { x: 5, y: 3 } }));
  await settle(40);
  const moved = b.msgs.slice(before).find(m => m.type === 'PLAYER_MOVED');
  assert.ok(moved, 'b received PLAYER_MOVED');
  a.ws.close(); b.ws.close();
  await settle(100);
});

await test('CLAIM_DAILY_BONUS updates coins to 1250', async () => {
  const a = await connect();
  await settle(40);
  const before = a.msgs.length;
  a.ws.send(JSON.stringify({ type: 'CLAIM_DAILY_BONUS', payload: {} }));
  await settle(50);
  const upd = a.msgs.slice(before).find(m => m.type === 'COINS_UPDATED');
  assert.ok(upd, 'got COINS_UPDATED');
  assert.equal(upd.payload.coins, 1250);
  a.ws.close();
  await settle(100);
});

// --- Cleanup ---

for (const c of wss.clients || []) c.terminate();
wss.close();
try { server.closeAllConnections?.(); } catch (_) {}
if (typeof db.close === 'function') db.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
