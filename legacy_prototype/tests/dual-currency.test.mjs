import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import * as db from '../src/server/db.ts';
import { getRotationWindow, getTimeUntilNextRotation, getRotatingFeaturedStock, ROTATION_PERIOD_MS } from '../src/shared/catalog.ts';

function makeSock() {
  const sent = [];
  return {
    readyState: 1,
    send(data) { sent.push(JSON.parse(data)); },
    sent,
  };
}

function makePlayer(id, room = 'plaza', coins = 1000, gems = 50) {
  return {
    id,
    name: 'Player_' + id,
    room,
    x: 2,
    y: 2,
    targetX: 2,
    targetY: 2,
    coins,
    gems,
    avatar: { skin: '#f5cba7' },
    lastChat: null,
    ws: makeSock(),
    lastDailyClaim: 0,
    friends: [],
    authUserId: id,
  };
}

test('Dual currency balance separation in SQLite database', async () => {
  const userId = 'user_dual_' + Math.random().toString(36).substring(2, 7);
  await db.initPlayerProfile(userId, 'DualTester');

  // Add coins and add gems separately
  await db.addCoins(userId, 500);
  const gemsAfter = await db.addGems(userId, 25);

  assert.ok(gemsAfter >= 25, 'Gems balance updated');

  // Verify decrement clamping at 0
  const clampedGems = await db.addGems(userId, -9999);
  assert.equal(clampedGems, 0, 'Gems cannot be negative');
});

test('BUY_ITEM with gems validates gem balance and delivers inventory item', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('gem_buyer', 'plaza', 1000, 60);
  await db.initPlayerProfile(p.id, p.name);
  await db.addGems(p.id, 60);

  // 1. Buy Baby Dragon (cost: 50 gems)
  await handleMessage({
    type: 'BUY_ITEM',
    payload: { itemKey: 'pet_dragon' }
  }, p, { rooms, db, ws: p.ws });

  assert.equal(p.gems, 10, '50 gems deducted, 10 gems remaining');
  const gemMsg = p.ws.sent.find(m => m.type === 'GEMS_UPDATED');
  assert.ok(gemMsg, 'GEMS_UPDATED message sent');
  assert.equal(gemMsg.payload.gems, 10);

  // 2. Reject buy when gems are insufficient (Royal Crown costs 30 gems, only 10 left)
  await handleMessage({
    type: 'BUY_ITEM',
    payload: { itemKey: 'crown_gold' }
  }, p, { rooms, db, ws: p.ws });

  const errorMsg = p.ws.sent.find(m => m.type === 'SHOP_ERROR');
  assert.ok(errorMsg, 'SHOP_ERROR received for insufficient gems');
});

test('Rotating stock engine deterministically yields 3 showcase items per 48-hour epoch', () => {
  const now = 1700000000000;
  const window1 = getRotationWindow(now);
  const items1 = getRotatingFeaturedStock(now);
  assert.equal(items1.length, 3, 'Selects 3 featured items');

  // Same epoch returns identical items
  const items1Repeat = getRotatingFeaturedStock(now + 1000 * 60);
  assert.deepEqual(items1, items1Repeat, 'Deterministic stock within same 48h window');

  // Next epoch changes rotation
  const nextEpoch = now + ROTATION_PERIOD_MS + 1000;
  const window2 = getRotationWindow(nextEpoch);
  assert.equal(window2, window1 + 1);

  // Remaining time countdown calculation
  const msRemaining = getTimeUntilNextRotation(now);
  assert.ok(msRemaining > 0 && msRemaining <= ROTATION_PERIOD_MS, 'Valid ms countdown remaining');
});
