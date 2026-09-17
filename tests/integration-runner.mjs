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

function connect(token) {
  const url = `ws://localhost:${port}` + (token ? `?token=${encodeURIComponent(token)}` : '');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
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

await test('INIT_STATE includes playerLoftRoomId for per-user sanctuary', async () => {
  const a = await connect();
  await settle(40);
  const init = a.msgs.find(m => m.type === 'INIT_STATE');
  assert.ok(init, 'got INIT_STATE');
  assert.ok(init.payload.playerLoftRoomId, 'playerLoftRoomId present in INIT_STATE');
  assert.ok(init.payload.playerLoftRoomId.startsWith('loft_'), 'loft room ID starts with loft_');
  assert.ok(init.payload.playerLoftName, 'playerLoftName present');
  a.ws.close();
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
  // Spawn is (4.5,7.5); (5,7) is one step away — inside the speed budget.
  a.ws.send(JSON.stringify({ type: 'MOVE', payload: { x: 5, y: 7 } }));
  await settle(40);
  const moved = b.msgs.slice(before).find(m => m.type === 'PLAYER_MOVED');
  assert.ok(moved, 'b received PLAYER_MOVED');
  // Authority tick (20Hz) must also emit compact PLAYER_DELTA frames.
  await settle(120);
  const delta = b.msgs.slice(before).find(m => m.type === 'PLAYER_DELTA');
  assert.ok(delta, 'b received PLAYER_DELTA');
  a.ws.close(); b.ws.close();
  await settle(100);
});

await test('CLAIM_DAILY_BONUS credits 250 coins on first claim', async () => {
  const a = await connect();
  await settle(40);
  const playerId = a.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;
  const before = a.msgs.length;
  a.ws.send(JSON.stringify({ type: 'CLAIM_DAILY_BONUS', payload: {} }));
  await settle(50);
  const upd = a.msgs.slice(before).find(m => m.type === 'COINS_UPDATED');
  assert.ok(upd, 'got COINS_UPDATED');
  assert.equal(upd.payload.coins, 1250);

  // Verify last_daily_claim was persisted in DB
  const claim = await db.getLastDailyClaim(playerId);
  assert.ok(claim > 0, 'lastDailyClaim persisted in DB');

  a.ws.close();
  await settle(100);
});

await test('CLAIM_DAILY_BONUS returns error if already claimed within 24h', async () => {
  const a = await connect();
  await settle(40);
  const playerId = a.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;

  // First claim — should succeed
  a.ws.send(JSON.stringify({ type: 'CLAIM_DAILY_BONUS', payload: {} }));
  await settle(50);

  // Second claim — should get DAILY_BONUS_ERROR
  const before = a.msgs.length;
  a.ws.send(JSON.stringify({ type: 'CLAIM_DAILY_BONUS', payload: {} }));
  await settle(50);
  const err = a.msgs.slice(before).find(m => m.type === 'DAILY_BONUS_ERROR');
  assert.ok(err, 'got DAILY_BONUS_ERROR on second claim');
  assert.ok(err.payload.message.includes('already collected'), 'error mentions already collected');
  assert.ok(err.payload.message.includes('Come back'), 'error mentions come back');

  // Should NOT have received COINS_UPDATED for the second claim
  const secondCoinsUpdate = a.msgs.slice(before).find(m => m.type === 'COINS_UPDATED');
  assert.ok(!secondCoinsUpdate, 'should not get COINS_UPDATED on second claim');

  a.ws.close();
  await settle(100);
});

await test('GET_DAILY_COOLDOWN returns canClaim=true for new player', async () => {
  const a = await connect();
  await settle(40);
  const before = a.msgs.length;
  a.ws.send(JSON.stringify({ type: 'GET_DAILY_COOLDOWN', payload: null }));
  await settle(50);
  const upd = a.msgs.slice(before).find(m => m.type === 'DAILY_COOLDOWN_UPDATE');
  assert.ok(upd, 'got DAILY_COOLDOWN_UPDATE');
  assert.equal(upd.payload.canClaim, true);
  a.ws.close();
  await settle(100);
});

// --- Account Persistence Tests ---

await test('Account signup persists player name across reconnects', async () => {
  // Signup via HTTP API
  const signupRes = await fetch(`http://localhost:${port}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testplayer_' + Date.now(), password: 'secret123' })
  });
  const signupData = await signupRes.json();
  assert.ok(signupData.success, 'signup succeeded');
  const playerId = signupData.playerId;

  // Connect with the token
  const a = await connect(playerId);
  await settle(40);
  const init = a.msgs.find(m => m.type === 'INIT_STATE');
  assert.equal(init.payload.selfId, playerId, 'server uses persistent player ID');
  assert.equal(init.payload.player.name, signupData.name, 'player name persisted from account');

  // Change the name
  a.ws.send(JSON.stringify({
    type: 'UPDATE_AVATAR',
    payload: { name: 'CustomName123' }
  }));
  await settle(50);

  // Verify name was persisted in DB
  const profile = await db.loadPlayerProfile(playerId);
  assert.ok(profile, 'profile loadable from DB');
  assert.equal(profile.name, 'CustomName123', 'name persisted in DB');

  a.ws.close();
  await settle(100);
});

await test('Account login returns persistent player data', async () => {
  // Signup first
  const username = 'loginplayer_' + Date.now();
  const password = 'secret456';
  await fetch(`http://localhost:${port}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  // Now login with the same credentials
  const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const loginData = await loginRes.json();
  assert.ok(loginData.success, 'login succeeded');
  assert.equal(loginData.name, username, 'returned correct name');

  // Connect with the token — should get the same player data
  const a = await connect(loginData.playerId);
  await settle(40);
  const init = a.msgs.find(m => m.type === 'INIT_STATE');
  assert.equal(init.payload.selfId, loginData.playerId, 'persistent ID on connect');
  assert.equal(init.payload.player.name, username, 'name persisted across sessions');
  assert.equal(init.payload.player.coins, 1000, 'coins persisted (default)');
  a.ws.close();
  await settle(100);
});

await test('Login with wrong password fails', async () => {
  const username = 'wrongpass_' + Date.now();
  const password = 'correctpass';
  await fetch(`http://localhost:${port}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'wrongpassword' })
  });
  const loginData = await loginRes.json();
  assert.equal(loginData.success, false, 'login with wrong password fails');
  assert.ok(loginData.error, 'error message present');
});

await test('Signup with duplicate username fails', async () => {
  const username = 'dupuser_' + Date.now();
  const password = 'pass1234';
  const res1 = await fetch(`http://localhost:${port}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data1 = await res1.json();
  assert.ok(data1.success, 'first signup succeeded');

  const res2 = await fetch(`http://localhost:${port}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data2 = await res2.json();
  assert.equal(data2.success, false, 'duplicate signup fails');
  assert.ok(data2.error?.includes('taken'), 'error mentions username taken');
});

// --- Personal Sanctuary Loft Tests ---

await test('Each player gets their own personal sanctuary loft', async () => {
  const a = await connect();
  const b = await connect();
  await settle(60);

  const aInit = a.msgs.find(m => m.type === 'INIT_STATE');
  const bInit = b.msgs.find(m => m.type === 'INIT_STATE');

  // Each player gets a different loft room ID
  assert.notEqual(aInit.payload.playerLoftRoomId, bInit.payload.playerLoftRoomId, 'loft IDs are unique per player');

  // The loft ID is derived from the player ID
  assert.ok(aInit.payload.playerLoftRoomId.includes(aInit.payload.selfId.substring(4, 12)), 'loft ID derived from player ID');

  a.ws.close(); b.ws.close();
  await settle(100);
});

await test('SWITCH_ROOM to personal loft loads and persists furniture', async () => {
  const a = await connect();
  await settle(40);
  const init = a.msgs.find(m => m.type === 'INIT_STATE');
  const loftId = init.payload.playerLoftRoomId;

  // Switch to the loft
  const before = a.msgs.length;
  a.ws.send(JSON.stringify({ type: 'SWITCH_ROOM', payload: { roomId: loftId } }));
  await settle(60);

  const roomChanged = a.msgs.slice(before).find(m => m.type === 'ROOM_CHANGED');
  assert.ok(roomChanged, 'got ROOM_CHANGED');
  assert.equal(roomChanged.payload.room.id, loftId, 'in the loft room');
  assert.ok(roomChanged.payload.room.name.includes('Personal Sanctuary Loft'), 'loft name correct');
  // Should have starter furniture
  assert.ok(roomChanged.payload.room.furniture.length > 0, 'loft has starter furniture');

  // Place new furniture
  a.ws.send(JSON.stringify({
    type: 'PLACE_FURNITURE',
    payload: { type: 'plant', x: 2, y: 3 }
  }));
  await settle(40);

  const furnAdded = a.msgs.find(m => m.type === 'FURNITURE_ADDED');
  assert.ok(furnAdded, 'got FURNITURE_ADDED');

  // Verify furniture was persisted in DB
  const dbFurn = await db.getLoftFurniture(loftId);
  assert.ok(dbFurn, 'furniture persisted in DB');
  assert.ok(dbFurn.some(f => f.type === 'plant'), 'plant furniture found in DB');

  a.ws.close();
  await settle(100);
});

// --- Friends System Integration Tests ---

await test('GET_FRIENDS_LIST returns empty initial list', async () => {
  const a = await connect();
  const before = a.msgs.length;
  a.ws.send(JSON.stringify({ type: 'GET_FRIENDS_LIST', payload: null }));
  await settle(50);
  const upd = a.msgs.slice(before).find(m => m.type === 'FRIENDS_LIST_UPDATE');
  assert.ok(upd, 'got FRIENDS_LIST_UPDATE');
  assert.equal(upd.payload.friends.length, 0, 'no friends initially');
  assert.equal(upd.payload.pendingRequests.length, 0, 'no pending requests initially');
  a.ws.close();
  await settle(100);
});

await test('SEND_FRIEND_REQUEST delivers request to recipient', async () => {
  const alice = await connect();
  const bob = await connect();
  await settle(50);

  // Get bob's name from INIT_STATE
  const bobInit = bob.msgs.find(m => m.type === 'INIT_STATE');
  const bobName = bobInit.payload.player.name;

  // Wait a bit more for both to be fully registered
  await settle(50);

  // Alice sends friend request to bob
  const beforeBob = bob.msgs.length;
  alice.ws.send(JSON.stringify({
    type: 'SEND_FRIEND_REQUEST',
    payload: { targetName: bobName }
  }));
  await settle(80);

  // Bob should receive FRIEND_REQUEST_RECEIVED
  const received = bob.msgs.slice(beforeBob).find(m => m.type === 'FRIEND_REQUEST_RECEIVED');
  assert.ok(received, 'bob received FRIEND_REQUEST_RECEIVED');
  const aliceName = alice.msgs.find(m => m.type === 'INIT_STATE').payload.player.name;
  assert.equal(received.payload.fromPlayerName, aliceName, 'correct sender');

  // Alice should receive FRIEND_REQUEST_SENT
  const sent = alice.msgs.find(m => m.type === 'FRIEND_REQUEST_SENT');
  assert.ok(sent, 'alice got FRIEND_REQUEST_SENT');
  assert.ok(sent.payload.message.includes('sent'), 'success message');

  alice.ws.close();
  bob.ws.close();
  await settle(100);
});

await test('ACCEPT_FRIEND_REQUEST makes players friends', async () => {
  const alice = await connect();
  const bob = await connect();
  await settle(50);

  const bobName = bob.msgs.find(m => m.type === 'INIT_STATE').payload.player.name;

  // Alice sends friend request
  alice.ws.send(JSON.stringify({
    type: 'SEND_FRIEND_REQUEST',
    payload: { targetName: bobName }
  }));
  await settle(80);

  // Bob gets the request
  const req = bob.msgs.find(m => m.type === 'FRIEND_REQUEST_RECEIVED');
  assert.ok(req, 'bob got friend request');

  // Get bob's player ID from INIT_STATE
  const bobId = bob.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;

  // Bob accepts
  const beforeAlice = alice.msgs.length;
  bob.ws.send(JSON.stringify({
    type: 'ACCEPT_FRIEND_REQUEST',
    payload: { requesterId: alice.msgs.find(m => m.type === 'INIT_STATE').payload.selfId }
  }));
  await settle(80);

  // Alice should get FRIEND_REQUEST_ACCEPTED
  const accepted = alice.msgs.slice(beforeAlice).find(m => m.type === 'FRIEND_REQUEST_ACCEPTED');
  assert.ok(accepted, 'alice got FRIEND_REQUEST_ACCEPTED');

  // Bob should also get FRIEND_REQUEST_ACCEPTED
  const bobAccepted = bob.msgs.find(m => m.type === 'FRIEND_REQUEST_ACCEPTED');
  assert.ok(bobAccepted, 'bob got FRIEND_REQUEST_ACCEPTED');

  // Now GET_FRIENDS_LIST should show the friend on both sides
  alice.ws.send(JSON.stringify({ type: 'GET_FRIENDS_LIST', payload: null }));
  await settle(50);
  const aliceFriends = alice.msgs.find(m => m.type === 'FRIENDS_LIST_UPDATE' && m.payload.friends);
  // Get the latest FRIENDS_LIST_UPDATE
  const aliceUpdates = alice.msgs.filter(m => m.type === 'FRIENDS_LIST_UPDATE');
  const latestAlice = aliceUpdates[aliceUpdates.length - 1];
  assert.ok(latestAlice.payload.friends.length >= 1, 'alice has at least 1 friend');

  alice.ws.close();
  bob.ws.close();
  await settle(100);
});

await test('SEND_PRIVATE_MESSAGE delivers to friend and blocks non-friends', async () => {
  const alice = await connect();
  const bob = await connect();
  const carol = await connect();
  await settle(50);

  const bobName = bob.msgs.find(m => m.type === 'INIT_STATE').payload.player.name;
  const bobId = bob.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;
  const carolId = carol.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;

  // Alice sends friend request to bob
  alice.ws.send(JSON.stringify({
    type: 'SEND_FRIEND_REQUEST',
    payload: { targetName: bobName }
  }));
  await settle(80);

  // Bob accepts
  bob.ws.send(JSON.stringify({
    type: 'ACCEPT_FRIEND_REQUEST',
    payload: { requesterId: alice.msgs.find(m => m.type === 'INIT_STATE').payload.selfId }
  }));
  await settle(80);

  // Alice sends PM to bob
  const beforeBob = bob.msgs.length;
  alice.ws.send(JSON.stringify({
    type: 'SEND_PRIVATE_MESSAGE',
    payload: { targetPlayerId: bobId, text: 'Hello bob!' }
  }));
  await settle(50);

  // Bob receives PRIVATE_MESSAGE_RECEIVED
  const pm = bob.msgs.slice(beforeBob).find(m => m.type === 'PRIVATE_MESSAGE_RECEIVED');
  assert.ok(pm, 'bob received PRIVATE_MESSAGE_RECEIVED');
  assert.equal(pm.payload.text, 'Hello bob!');
  const aliceName = alice.msgs.find(m => m.type === 'INIT_STATE').payload.player.name;
  assert.equal(pm.payload.fromPlayerName, aliceName);

  // Alice also gets an echo
  const alicePM = alice.msgs.find(m => m.type === 'PRIVATE_MESSAGE_RECEIVED');
  assert.ok(alicePM, 'alice got PM echo');

  // Alice tries to PM carol (not a friend) — should get error
  const beforeAlice = alice.msgs.length;
  alice.ws.send(JSON.stringify({
    type: 'SEND_PRIVATE_MESSAGE',
    payload: { targetPlayerId: carolId, text: 'Hello carol!' }
  }));
  await settle(50);

  const pmError = alice.msgs.slice(beforeAlice).find(m => m.type === 'PRIVATE_MESSAGE_ERROR');
  assert.ok(pmError, 'alice got PRIVATE_MESSAGE_ERROR for non-friend');

  alice.ws.close();
  bob.ws.close();
  carol.ws.close();
  await settle(100);
});

await test('GET_PRIVATE_MESSAGES returns message history', async () => {
  const alice = await connect();
  const bob = await connect();
  await settle(50);

  const bobId = bob.msgs.find(m => m.type === 'INIT_STATE').payload.selfId;

  // Alice sends friend request and bob accepts
  const bobName = bob.msgs.find(m => m.type === 'INIT_STATE').payload.player.name;
  alice.ws.send(JSON.stringify({
    type: 'SEND_FRIEND_REQUEST',
    payload: { targetName: bobName }
  }));
  await settle(80);
  bob.ws.send(JSON.stringify({
    type: 'ACCEPT_FRIEND_REQUEST',
    payload: { requesterId: alice.msgs.find(m => m.type === 'INIT_STATE').payload.selfId }
  }));
  await settle(80);

  // Alice sends a PM to bob
  alice.ws.send(JSON.stringify({
    type: 'SEND_PRIVATE_MESSAGE',
    payload: { targetPlayerId: bobId, text: 'History test message' }
  }));
  await settle(50);

  // Bob requests private message history
  bob.ws.send(JSON.stringify({ type: 'GET_PRIVATE_MESSAGES', payload: null }));
  await settle(50);

  const msgList = bob.msgs.find(m => m.type === 'PRIVATE_MESSAGES_LIST');
  assert.ok(msgList, 'bob got PRIVATE_MESSAGES_LIST');
  assert.ok(msgList.payload.messages.length > 0, 'message history is non-empty');
  assert.equal(msgList.payload.messages[0].text, 'History test message');

  alice.ws.close();
  bob.ws.close();
  await settle(100);
});

// --- Cleanup ---

for (const c of wss.clients || []) c.terminate();
wss.close();
try { server.closeAllConnections?.(); } catch (_) {}
if (typeof db.close === 'function') db.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
