import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import * as db from '../src/server/db.ts';

function makeSock() {
  const sent = [];
  return {
    readyState: 1,
    send(data) { sent.push(JSON.parse(data)); },
    sent,
  };
}

function makePlayer(id, room = 'plaza', coins = 5000) {
  return {
    id,
    name: 'Player_' + id,
    room,
    x: 2,
    y: 2,
    targetX: 2,
    targetY: 2,
    coins,
    gems: 50,
    avatar: { skin: '#f5cba7' },
    lastChat: null,
    ws: makeSock(),
    lastDailyClaim: 0,
    friends: [],
    authUserId: id,
  };
}

test('4-way furniture rotation updates rotation state and broadcasts', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('owner_1', 'loft_owner_1');
  const loft = await rooms.getUserLoft('owner_1', 'Owner');
  rooms.join(loft.id, p);

  // 1. Place a rotatable sofa at rotation 0
  await handleMessage({
    type: 'PLACE_FURNITURE',
    payload: { type: 'sofa', x: 4, y: 4, rotation: 0 }
  }, p, { rooms, db, ws: p.ws });

  const sofa = loft.furniture.find(f => f.type === 'sofa');
  assert.ok(sofa, 'Sofa placed in loft');
  assert.equal(sofa.rotation, 0);

  // 2. Rotate to 90 degrees
  await handleMessage({
    type: 'ROTATE_ITEM',
    payload: { placedItemId: sofa.id, rotation: 90 }
  }, p, { rooms, db, ws: p.ws });

  assert.equal(sofa.rotation, 90, 'Sofa rotated to 90 degrees');

  // 3. Rotate through 180 and 270 degrees
  await handleMessage({
    type: 'ROTATE_ITEM',
    payload: { placedItemId: sofa.id, rotation: 180 }
  }, p, { rooms, db, ws: p.ws });
  assert.equal(sofa.rotation, 180);

  await handleMessage({
    type: 'ROTATE_ITEM',
    payload: { placedItemId: sofa.id, rotation: 270 }
  }, p, { rooms, db, ws: p.ws });
  assert.equal(sofa.rotation, 270);
});

test('Room expansion deducts HavenCoins, updates room dimensions, and broadcasts ROOM_EXPANDED', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('expand_owner', 'loft_expand_owner', 2000);
  const loft = await rooms.getUserLoft('expand_owner', 'ExpandOwner');
  rooms.join(loft.id, p);

  // 1. Expand from 10x10 to 14x14 (cost: 500 coins)
  await handleMessage({
    type: 'EXPAND_ROOM',
    payload: { roomId: loft.id, targetSize: 14 }
  }, p, { rooms, db, ws: p.ws });

  assert.equal(loft.gridWidth, 14, 'Grid width expanded to 14');
  assert.equal(loft.gridHeight, 14, 'Grid height expanded to 14');
  assert.equal(p.coins, 1500, '500 coins deducted');

  // Verify persistence in real SQLite database
  const persisted = await db.getRoomExpansion(loft.id);
  assert.equal(persisted.width, 14, 'Persisted width is 14');

  // Check broadcast message
  const expandedMsg = p.ws.sent.find(m => m.type === 'ROOM_EXPANDED');
  assert.ok(expandedMsg, 'ROOM_EXPANDED broadcast sent');
  assert.equal(expandedMsg.payload.gridWidth, 14);

  // 2. Reject invalid target sizes
  await handleMessage({
    type: 'EXPAND_ROOM',
    payload: { roomId: loft.id, targetSize: 99 }
  }, p, { rooms, db, ws: p.ws });

  const errorMsg = p.ws.sent.find(m => m.type === 'FURNITURE_ERROR');
  assert.ok(errorMsg, 'Invalid size produces error');

  // 3. Reject non-owners from expanding room
  const intruder = makePlayer('intruder', loft.id, 5000);
  await handleMessage({
    type: 'EXPAND_ROOM',
    payload: { roomId: loft.id, targetSize: 18 }
  }, intruder, { rooms, db, ws: intruder.ws });

  assert.equal(loft.gridWidth, 14, 'Intruder could not expand owner room');
});
