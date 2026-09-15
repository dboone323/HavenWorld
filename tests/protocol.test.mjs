import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.js';
import { handleMessage } from '../src/server/protocol.js';

function makeSock() {
  const sent = [];
  return {
    readyState: 1,
    send(data) { sent.push(data); },
    sent
  };
}
function makePlayer(id, room = 'plaza') {
  return { id, name: 'P' + id, room, x: 0, y: 0, targetX: 0, targetY: 0,
    coins: 0, avatar: { skin: '#fff' }, lastChat: null, ws: makeSock() };
}
function mockDb() {
  const calls = { saveAvatar: 0, addCoins: 0, addFurniture: 0, removeFurniture: 0 };
  const api = {
    saveAvatar: async () => { calls.saveAvatar++; },
    addCoins: async () => { calls.addCoins++; },
    addFurniture: async () => { calls.addFurniture++; },
    removeFurniture: async () => { calls.removeFurniture++; },
    getMode: () => 'memory', isConfigured: () => false
  };
  return { api, calls };
}
const C = (rooms, db, p) => ({ rooms, db, ws: p.ws });

test('MOVE clamps to grid and broadcasts PLAYER_MOVED', () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'MOVE', payload: { x: 99, y: -5 } }, p, C(rooms, api, p));
  assert.equal(p.targetX, 11);
  assert.equal(p.targetY, 0);
  assert.equal(JSON.parse(p.ws.sent[0]).type, 'PLAYER_MOVED');
});

test('CHAT broadcasts trimmed text', () => {
  const rooms = new RoomManager(); const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'CHAT', payload: { text: '  hello  ' } }, p, C(rooms, api, p));
  const m = JSON.parse(p.ws.sent[0]);
  assert.equal(m.type, 'CHAT_MESSAGE');
  assert.equal(m.payload.text, 'hello');
  // empty after trim -> no broadcast
  p.ws.sent = [];
  handleMessage({ type: 'CHAT', payload: { text: '   ' } }, p, C(rooms, api, p));
  assert.equal(p.ws.sent.length, 0);
});

test('CHAT /name renames the player', () => {
  const rooms = new RoomManager(); const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'CHAT', payload: { text: '/name Rex' } }, p, C(rooms, api, p));
  assert.equal(p.name, 'Rex');
  assert.equal(JSON.parse(p.ws.sent[0]).type, 'PLAYER_PROFILE_UPDATED');
});

test('UPDATE_AVATAR persists and broadcasts', () => {
  const rooms = new RoomManager(); const { api, calls } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'UPDATE_AVATAR', payload: { avatar: { shirtColor: '#ff0000' } } }, p, C(rooms, api, p));
  assert.equal(p.avatar.shirtColor, '#ff0000');
  assert.equal(calls.saveAvatar, 1);
  assert.equal(JSON.parse(p.ws.sent[0]).type, 'PLAYER_PROFILE_UPDATED');
});

test('SWITCH_ROOM relocates the player and notifies others', () => {
  const rooms = new RoomManager(); const { api } = mockDb();
  const a = makePlayer('a'); const b = makePlayer('b');
  rooms.join('plaza', a); rooms.join('plaza', b);
  handleMessage({ type: 'SWITCH_ROOM', payload: { roomId: 'sanctuary_loft' } }, a, C(rooms, api, a));
  assert.equal(a.room, 'sanctuary_loft');
  assert.equal(a.x, 5);
  assert.equal(JSON.parse(a.ws.sent[0]).type, 'ROOM_CHANGED');
  assert.equal(JSON.parse(b.ws.sent[b.ws.sent.length - 1]).type, 'PLAYER_LEFT');
});

test('PLACE_FURNITURE is ignored outside the loft', () => {
  const rooms = new RoomManager(); const { calls } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'PLACE_FURNITURE', payload: { type: 'plant', x: 1, y: 1 } }, p, C(rooms, mockDb().api, p));
  assert.equal(calls.addFurniture, 0);
});

test('CLAIM_DAILY_BONUS credits 250 coins', () => {
  const rooms = new RoomManager(); const { api, calls } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'CLAIM_DAILY_BONUS', payload: {} }, p, C(rooms, api, p));
  assert.equal(p.coins, 250);
  assert.equal(calls.addCoins, 1);
  const m = JSON.parse(p.ws.sent[0]);
  assert.equal(m.type, 'COINS_UPDATED');
  assert.equal(m.payload.coins, 250);
});

test('MINIGAME_SCORE computes a clamped reward', () => {
  const rooms = new RoomManager(); const { api, calls } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'MINIGAME_SCORE', payload: { score: 200 } }, p, C(rooms, api, p));
  const reward = Math.max(50, Math.min(500, Math.floor(200 / 2)));
  assert.equal(p.coins, reward);
  assert.equal(calls.addCoins, 1);
});

test('unknown message type is a safe no-op', () => {
  const rooms = new RoomManager(); const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  assert.doesNotThrow(() => handleMessage({ type: 'BOGUS', payload: {} }, p, C(rooms, api, p)));
});
