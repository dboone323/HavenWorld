import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import { AuthorityTicker } from '../src/server/tick.ts';
import {
  validateMoveRequest,
  needsReconcile,
  encodePlayerDelta,
  decodePlayerDelta,
  intToFacing,
  facingToInt,
  RECONCILE_EPSILON,
} from '../src/shared/authority.ts';
import {
  furnitureDepthKey,
  avatarDepthKey,
  sortEntities,
} from '../src/shared/zsort.ts';

function makeSock() {
  const sent = [];
  return { readyState: 1, send(data) { sent.push(data); }, sent };
}
function makePlayer(id, x = 0, y = 0, room = 'plaza') {
  return {
    id, name: 'P' + id, room, x, y, targetX: x, targetY: y,
    coins: 1000, gems: 0, avatar: { skin: '#fff' }, lastChat: null,
    ws: makeSock(), lastDailyClaim: 0, friends: [], authUserId: null,
  };
}
function mockDb() {
  return {
    saveAvatar: async () => {}, addCoins: async () => {},
    addFurniture: async () => {}, removeFurniture: async () => {},
    getMode: () => 'memory', close: () => {},
    savePlayerName: async () => {}, saveLastDailyClaim: async () => {},
    getLastDailyClaim: async () => 0,
    getInventory: async () => [], addItem: async () => {}, removeItem: async () => {},
    getFriends: async () => [], getPendingFriendRequests: async () => [],
    sendFriendRequest: async () => ({ success: true, message: 'ok' }),
    acceptFriendRequest: async () => ({ success: true, message: 'ok' }),
    areFriends: async () => false, saveMessage: async () => {}, getMessages: async () => [],
    getRoomFurniture: async () => null, getLoftFurniture: async () => null,
    getUserSanctuaryRoom: async () => ({ roomId: 'loft_t', roomCode: 'loft_t', name: 'T' }),
  };
}
const C = (rooms, db, p) => ({ rooms, db, ws: p.ws, dailyCooldownMs: 86400000 });

// --- 1.1 Server-Side Authority ---

test('MOVE_REQUEST within speed budget is accepted and broadcasts PLAYER_MOVED', async () => {
  const rooms = new RoomManager();
  const db = mockDb();
  const p = makePlayer('a', 5, 5);
  rooms.join('plaza', p);
  await handleMessage({ type: 'MOVE_REQUEST', payload: { targetX: 6, targetY: 5 } }, p, C(rooms, db, p));
  assert.equal(p.targetX, 6);
  assert.equal(p.targetY, 5);
  const m = JSON.parse(p.ws.sent[0]);
  assert.equal(m.type, 'PLAYER_MOVED');
  assert.equal(m.payload.targetX, 6);
});

test('far click-to-move target is accepted; non-finite input is rejected', async () => {
  const rooms = new RoomManager();
  const db = mockDb();
  const p = makePlayer('a', 0, 0);
  rooms.join('plaza', p);
  await handleMessage({ type: 'MOVE_REQUEST', payload: { targetX: 11, targetY: 11 } }, p, C(rooms, db, p));
  assert.equal(p.targetX, 11);
  assert.equal(p.targetY, 11);
  p.ws.sent.length = 0;
  await handleMessage({ type: 'MOVE_REQUEST', payload: { targetX: NaN, targetY: 3 } }, p, C(rooms, db, p));
  assert.equal(p.targetX, 11); // unchanged
  assert.equal(JSON.parse(p.ws.sent[0]).type, 'MOVE_REJECTED');
});

test('teleport-speed UPDATE_POSITION claims are corrected with RECONCILE_POSITION', async () => {
  const rooms = new RoomManager();
  const db = mockDb();
  const p = makePlayer('a', 0, 0);
  rooms.join('plaza', p);
  // Simulating a hacked client that claims to be across the map: server
  // never adopts the claim and orders the client back to server truth.
  await handleMessage({ type: 'UPDATE_POSITION', payload: { x: 11, y: 11 } }, p, C(rooms, db, p));
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
  const m = JSON.parse(p.ws.sent[0]);
  assert.equal(m.type, 'RECONCILE_POSITION');
});

test('legacy MOVE still works (alias) and clamps to grid', async () => {
  const rooms = new RoomManager();
  const db = mockDb();
  const p = makePlayer('a', 5, 5);
  rooms.join('plaza', p);
  await handleMessage({ type: 'MOVE', payload: { x: 99, y: -5 } }, p, C(rooms, db, p));
  // clamped into [0,11]: any in-bounds target is accepted (server sim walks it)
  assert.equal(p.targetX, 11);
  assert.equal(p.targetY, 0);
});

test('UPDATE_POSITION never mutates server state; drift triggers RECONCILE_POSITION', async () => {
  const rooms = new RoomManager();
  const db = mockDb();
  const p = makePlayer('a', 5, 5);
  rooms.join('plaza', p);
  await handleMessage({ type: 'UPDATE_POSITION', payload: { x: 9, y: 9 } }, p, C(rooms, db, p));
  assert.equal(p.x, 5); // server truth untouched
  const m = JSON.parse(p.ws.sent[0]);
  assert.equal(m.type, 'RECONCILE_POSITION');
  assert.equal(m.payload.x, 5);
});

test('UPDATE_POSITION within epsilon sends nothing', async () => {
  const rooms = new RoomManager();
  const db = mockDb();
  const p = makePlayer('a', 5, 5);
  rooms.join('plaza', p);
  await handleMessage({ type: 'UPDATE_POSITION', payload: { x: 5.1, y: 5.1 } }, p, C(rooms, db, p));
  assert.equal(p.ws.sent.length, 0);
});

test('validateMoveRequest rejects non-finite input', () => {
  const p = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const v = validateMoveRequest(p, NaN, 3, Date.now());
  assert.equal(v.ok, false);
});

test('needsReconcile uses 0.5 tile epsilon', () => {
  assert.equal(needsReconcile({ x: 0, y: 0 }, { x: 0.4, y: 0 }, RECONCILE_EPSILON), false);
  assert.equal(needsReconcile({ x: 0, y: 0 }, { x: 2, y: 0 }, RECONCILE_EPSILON), true);
});

test('20Hz tick advances players server-side via real stepToward', () => {
  const rooms = new RoomManager();
  const db = mockDb();
  void db;
  const p = makePlayer('a', 0, 0);
  p.targetX = 3; p.targetY = 0;
  rooms.join('plaza', p);
  const ticker = new AuthorityTicker(rooms, { broadcast: false });
  const s = ticker.tickOnce();
  assert.equal(s.moved, 1);
  assert.ok(p.x > 0 && p.x < 3, `x advanced fractionally, got ${p.x}`);
  assert.equal(p.isWalking, true);
});

// --- 1.3 Z-Index Sorting ---

test('tall furniture sorts after avatar on same tile; rug sorts before', () => {
  const avatar = avatarDepthKey({ x: 5, y: 5 });
  const tree = furnitureDepthKey({ type: 'tree', x: 5, y: 5 });
  const rug = furnitureDepthKey({ type: 'rug', x: 5, y: 5 });
  const sofa = furnitureDepthKey({ type: 'sofa', x: 5, y: 5 });
  assert.ok(rug < avatar, 'rug behind avatar');
  assert.ok(sofa < avatar, 'low sofa in front of rug but behind avatar');
  assert.ok(avatar < tree, 'tall tree occludes avatar');
});

test('multi-tile 2x3 sofa anchors on far corner (no z-fight)', () => {
  const near = furnitureDepthKey({ type: 'sofa', x: 2, y: 2, w: 2, h: 3 });
  const far = furnitureDepthKey({ type: 'sofa', x: 3, y: 4 });
  assert.equal(near, far);
});

test('sortEntities orders rug < avatar < tall wall', () => {
  const ents = sortEntities(
    [{ type: 'rug', x: 4, y: 4 }, { type: 'wall', x: 4, y: 4 }],
    { x: 4, y: 4 },
    [],
  );
  assert.equal(ents[0].kind, 'furniture');
  assert.equal(ents[1].kind, 'avatar');
  assert.equal(ents[2].kind, 'furniture');
  assert.equal(ents[2].item.type, 'wall');
});

// --- 1.5 Delta Sync ---

test('PLAYER_DELTA round-trips through compact codec', () => {
  const d = encodePlayerDelta('usr_x', { x: 5.123, y: 7.456, facing: 'NW', isSitting: false, isWalking: true });
  assert.deepEqual(d, ['usr_x', 5.12, 7.46, 3, 2]);
  const s = decodePlayerDelta(d);
  assert.equal(s.facing, 'NW');
  assert.equal(s.isWalking, true);
  assert.equal(facingToInt(intToFacing(0)), 0);
});

test('tick emits PLAYER_DELTA only for dirty players (bandwidth win)', () => {
  const rooms = new RoomManager();
  const a = makePlayer('a', 0, 0);
  a.targetX = 5; a.targetY = 0; // moving => dirty
  const b = makePlayer('b', 3, 3); // idle => clean after first tick
  rooms.join('plaza', a);
  rooms.join('plaza', b);
  const ticker = new AuthorityTicker(rooms, { broadcast: false });
  ticker.tickOnce(); // seeds lastTick
  a.ws.sent.length = 0; b.ws.sent.length = 0;
  const t2 = new AuthorityTicker(rooms, { broadcast: true });
  // broadcast:true with real sockets (readyState 1) pushes JSON to sent[]
  const s = t2.tickOnce();
  assert.ok(s.deltasSent >= 1);
  const deltas = JSON.parse(a.ws.sent[0]).payload.deltas;
  const ids = deltas.map((d) => d[0]);
  assert.ok(ids.includes('a'), 'mover included');
  assert.ok(!ids.includes('b'), 'idle player excluded from delta');
  const full = JSON.stringify(rooms.othersIn('plaza', 'x'));
  const delta = a.ws.sent[0];
  assert.ok(delta.length < full.length, `delta ${delta.length}B < full ${full.length}B`);
});
