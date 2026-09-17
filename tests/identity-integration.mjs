import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = ':memory:';
process.env.HAVEN_NO_TICK = '1';
const { server, wss, db } = await import('../src/server/server.ts');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const sockets = [];
function wait(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', receive); reject(new Error(`Missing ${type}`)); }, 2000);
    function receive(raw) {
      const msg = JSON.parse(String(raw));
      if (msg.type === type) { clearTimeout(timer); ws.off('message', receive); resolve(msg.payload); }
    }
    ws.on('message', receive);
  });
}
async function connect(id) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}?token=${id}`);
  sockets.push(ws);
  const init = await wait(ws, 'INIT_STATE');
  return { ws, init };
}
async function send(ws, type, payload, responseType = 'IDENTITY_UPDATED') {
  const response = wait(ws, responseType);
  ws.send(JSON.stringify({ type, payload }));
  return response;
}
try {
  const account = await fetch(`${url}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'IdentityRoundTrip', password: 'local-test-only' })
  }).then(r => r.json());
  assert.equal(account.success, true);
  const date = await db.getRegistrationDate(account.playerId);
  assert.ok(Number.isFinite(Date.parse(date)));
  const first = await connect(account.playerId);
  assert.equal(first.init.player.registeredAt, date);
  const updated = await send(first.ws, 'UPDATE_IDENTITY', { statusMessage: '<b>Building</b> a cozy home', title: '' });
  console.log('UPDATE_IDENTITY response:', JSON.stringify({ type: 'IDENTITY_UPDATED', payload: updated }));
  assert.equal(updated.statusMessage, 'Building a cozy home');
  assert.ok(updated.passport.unlockedStamps);
  assert.equal(updated.presets.length, 3);
  const saved = await send(first.ws, 'SAVE_PRESET', { slot: 1, avatar: { shirtStyle: 'hoodie', shirtColor: '#123456', shoesColor: '#abcdef' } });
  assert.equal(saved.presets[1].shirtStyle, 'hoodie');
  await send(first.ws, 'APPLY_PRESET', { slot: 1 });
  const loaded = await db.loadIdentity(account.playerId);
  assert.equal(loaded.statusMessage, 'Building a cozy home');
  assert.equal(loaded.presets[1].shoesColor, '#abcdef');
  assert.equal(loaded.outfit.shirtColor, '#123456');
  const rejected = await send(first.ws, 'UPDATE_IDENTITY', { title: 'chef' }, 'IDENTITY_ERROR');
  assert.match(rejected.message, /not unlocked/);
  await new Promise(resolve => { first.ws.once('close', resolve); first.ws.close(); });
  await new Promise(resolve => setTimeout(resolve, 25));
  const second = await connect(account.playerId);
  assert.equal(second.init.player.registeredAt, date);
  assert.equal(second.init.player.avatar.shirtStyle, 'hoodie');
  assert.equal(second.init.player.statusMessage, 'Building a cozy home');
  const restored = await send(second.ws, 'APPLY_PRESET', { slot: 1 });
  assert.deepEqual(restored.presets, loaded.presets);
  await db.initPlayerProfile(account.playerId, account.name);
  await db.savePlayerName(account.playerId, account.name);
  assert.equal(await db.getRegistrationDate(account.playerId), date);
  console.log('PASS: identity + preset save/load/reconnect; locked title rejected; registration date unchanged');
} finally {
  for (const ws of sockets) ws.terminate();
  for (const ws of wss.clients) ws.terminate();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
  db.close();
}
