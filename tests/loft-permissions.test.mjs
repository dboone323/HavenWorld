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

function makePlayer(id, room = 'plaza') {
  return {
    id,
    name: 'Player_' + id,
    room,
    x: 2,
    y: 2,
    targetX: 2,
    targetY: 2,
    coins: 1000,
    gems: 50,
    avatar: { skin: '#f5cba7' },
    lastChat: null,
    ws: makeSock(),
    lastDailyClaim: 0,
    friends: [],
    authUserId: id,
  };
}

test('Room permissions matrix enforces public, friends, password, and locked access modes', async () => {
  const rooms = new RoomManager();
  const owner = makePlayer('owner_perm', 'loft_owner_perm');
  const visitor = makePlayer('visitor_1', 'plaza');
  const globalPlayers = new Map([[owner.id, owner], [visitor.id, visitor]]);

  const loft = await rooms.getUserLoft('owner_perm', 'PermOwner');
  rooms.join(loft.id, owner);

  // 1. Default: public access
  loft.accessMode = 'public';
  assert.equal(rooms.canAccess(loft.id, visitor.id).allowed, true, 'Public room allows visitor');

  // 2. Friends-only mode
  loft.accessMode = 'friends';
  assert.equal(rooms.canAccess(loft.id, visitor.id, null, false).allowed, false, 'Non-friend blocked');
  assert.equal(rooms.canAccess(loft.id, visitor.id, null, true).allowed, true, 'Friend allowed');

  // 3. Password mode
  loft.accessMode = 'password';
  loft.passwordHash = 'secret123';
  assert.equal(rooms.canAccess(loft.id, visitor.id, null).allowed, false, 'Missing password blocked');
  assert.equal(rooms.canAccess(loft.id, visitor.id, 'wrong').allowed, false, 'Wrong password blocked');
  assert.equal(rooms.canAccess(loft.id, visitor.id, 'secret123').allowed, true, 'Correct password allowed');

  // 4. Locked mode
  loft.accessMode = 'locked';
  assert.equal(rooms.canAccess(loft.id, visitor.id).allowed, false, 'Visitor blocked from locked room');
  assert.equal(rooms.canAccess(loft.id, owner.id).allowed, true, 'Owner always allowed in locked room');
});

test('Co-building decorator rights allow authorized friends to place and remove furniture', async () => {
  const rooms = new RoomManager();
  const owner = makePlayer('owner_dec', 'loft_owner_dec');
  const friend = makePlayer('friend_dec', 'loft_owner_dec');
  const stranger = makePlayer('stranger_dec', 'loft_owner_dec');

  const loft = await rooms.getUserLoft('owner_dec', 'DecOwner');
  rooms.join(loft.id, owner);
  rooms.join(loft.id, friend);
  rooms.join(loft.id, stranger);

  // Stranger cannot decorate
  assert.equal(rooms.canDecorate(loft.id, stranger.id), false);
  await handleMessage({
    type: 'PLACE_FURNITURE',
    payload: { type: 'table', x: 2, y: 2 }
  }, stranger, { rooms, db, ws: stranger.ws });
  const errorMsg = stranger.ws.sent.find(m => m.type === 'FURNITURE_ERROR');
  assert.ok(errorMsg, 'Stranger receives FURNITURE_ERROR');

  // Grant friend decorator permissions
  await handleMessage({
    type: 'GRANT_DECORATOR',
    payload: { roomId: loft.id, targetPlayerId: friend.id }
  }, owner, { rooms, db, ws: owner.ws });

  assert.equal(rooms.canDecorate(loft.id, friend.id), true, 'Friend is now decorator');

  // Friend places furniture successfully
  await handleMessage({
    type: 'PLACE_FURNITURE',
    payload: { type: 'table', x: 3, y: 3 }
  }, friend, { rooms, db, ws: friend.ws });

  const placed = loft.furniture.find(f => f.x === 3 && f.y === 3);
  assert.ok(placed, 'Friend successfully placed furniture with decorator rights');

  // Revoke decorator rights
  await handleMessage({
    type: 'REVOKE_DECORATOR',
    payload: { roomId: loft.id, targetPlayerId: friend.id }
  }, owner, { rooms, db, ws: owner.ws });

  assert.equal(rooms.canDecorate(loft.id, friend.id), false, 'Decorator revoked');
});

test('Doorbell handshake notifies owner and allows owner to grant entry pass', async () => {
  const rooms = new RoomManager();
  const owner = makePlayer('doorbell_host', 'loft_doorbell_host');
  const visitor = makePlayer('doorbell_visitor', 'plaza');
  const globalPlayers = new Map([[owner.id, owner], [visitor.id, visitor]]);

  const loft = await rooms.getUserLoft('doorbell_host', 'DoorbellHost');
  loft.accessMode = 'locked';
  rooms.join(loft.id, owner);

  // Visitor rings doorbell
  await handleMessage({
    type: 'RING_DOORBELL',
    payload: { roomId: loft.id }
  }, visitor, { rooms, db, ws: visitor.ws, globalPlayers });

  // Host receives chime notification
  const ringMsg = owner.ws.sent.find(m => m.type === 'DOORBELL_RING');
  assert.ok(ringMsg, 'Host received DOORBELL_RING');
  assert.equal(ringMsg.payload.visitorId, visitor.id);

  // Host allows entry
  await handleMessage({
    type: 'DOORBELL_DECISION',
    payload: { visitorId: visitor.id, allow: true }
  }, owner, { rooms, db, ws: owner.ws, globalPlayers });

  // Visitor receives DOORBELL_RESULT and has entry grant
  const resultMsg = visitor.ws.sent.find(m => m.type === 'DOORBELL_RESULT');
  assert.ok(resultMsg, 'Visitor received DOORBELL_RESULT');
  assert.equal(resultMsg.payload.granted, true);
  assert.equal(rooms.canAccess(loft.id, visitor.id).allowed, true, 'Visitor can now enter loft');
});

test('Ambient mood settings update room lighting and broadcast ROOM_MOOD_UPDATED', async () => {
  const rooms = new RoomManager();
  const owner = makePlayer('mood_owner', 'loft_mood_owner');
  const loft = await rooms.getUserLoft('mood_owner', 'MoodOwner');
  rooms.join(loft.id, owner);

  // Set mood to cyber_neon
  await handleMessage({
    type: 'SET_ROOM_MOOD',
    payload: { roomId: loft.id, mood: 'cyber_neon' }
  }, owner, { rooms, db, ws: owner.ws });

  assert.equal(loft.ambientMood, 'cyber_neon');
  const moodMsg = owner.ws.sent.find(m => m.type === 'ROOM_MOOD_UPDATED');
  assert.ok(moodMsg, 'ROOM_MOOD_UPDATED broadcasted');
  assert.equal(moodMsg.payload.mood, 'cyber_neon');

  // Verify DB persistence
  const savedMood = await db.getRoomMood(loft.id);
  assert.equal(savedMood, 'cyber_neon');
});

test('Teleporter trigger transports avatar to destination room', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('teleport_user', 'sanctuary_loft');
  const sanctuary = rooms.get('sanctuary_loft');
  rooms.join('sanctuary_loft', p);

  // Place teleporter pad linked to plaza
  sanctuary.furniture.push({
    id: 'f_teleport_1',
    type: 'teleporter_pad',
    x: 4,
    y: 4,
    rotation: 0,
    teleportTarget: 'plaza',
  });

  // Trigger teleporter
  await handleMessage({
    type: 'TELEPORT_TRIGGER',
    payload: { teleporterId: 'f_teleport_1' }
  }, p, { rooms, db, ws: p.ws });

  assert.equal(p.room, 'plaza', 'Player transported to plaza');
  const roomChanged = p.ws.sent.find(m => m.type === 'ROOM_CHANGED');
  assert.ok(roomChanged, 'ROOM_CHANGED message sent');
  assert.equal(roomChanged.payload.room.id, 'plaza');
});
