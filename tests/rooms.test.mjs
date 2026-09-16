import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, serializePlayer, createDefaultRooms } from '../src/server/rooms.ts';

function makeSock() {
  const sent = [];
  return {
    readyState: 1,
    send(data) { sent.push(data); },
    sent
  };
}
function basePlayer(id, room = 'plaza') {
  return { id, name: 'P' + id, room, x: 0, y: 0, targetX: 0, targetY: 0,
    coins: 0, avatar: { skin: '#fff' }, lastChat: null, ws: makeSock() };
}

test('default registry has plaza + loft', () => {
  const rm = new RoomManager();
  assert.deepEqual(rm.list(), ['plaza', 'sanctuary_loft']);
  assert.equal(rm.has('plaza'), true);
  assert.equal(rm.has('nope'), false);
  assert.equal(rm.get('plaza').isPublic, true);
  assert.equal(rm.get('plaza').furniture.length, 6);
  assert.equal(rm.get('sanctuary_loft').furniture.length, 5);
});

test('join / leave / othersIn excludes the subject', () => {
  const rm = new RoomManager();
  const a = basePlayer('a'); const b = basePlayer('b');
  rm.join('plaza', a); rm.join('plaza', b);
  assert.deepEqual(rm.othersIn('plaza', 'a').map(p => p.id), ['b']);
  rm.leave(a);
  assert.equal(rm.othersIn('plaza', 'b').length, 0);
});

test('serializePlayer omits the ws handle', () => {
  const p = basePlayer('x');
  const out = serializePlayer(p);
  assert.equal(out.id, 'x');
  assert.equal('ws' in out, false);
  assert.equal(out.coins, 0);
});

test('broadcast excludes the origin socket only', () => {
  const rm = new RoomManager();
  const a = basePlayer('a'); const b = basePlayer('b');
  rm.join('plaza', a); rm.join('plaza', b);
  rm.broadcast('plaza', { type: 'PING' }, a.ws);
  assert.equal(b.ws.sent.length, 1);
  assert.equal(a.ws.sent.length, 0);
});

test('furniture add / remove / clear lifecycle', () => {
  const rm = new RoomManager();
  const room = rm.get('plaza');
  const before = room.furniture.length;
  rm.addFurniture('plaza', { id: 'f_new', type: 'plant', x: 1, y: 1, rotation: 0 });
  assert.equal(room.furniture.length, before + 1);
  const removed = rm.removeFurnitureById('plaza', 'f_new');
  assert.equal(removed.id, 'f_new');
  assert.equal(room.furniture.length, before);
    const cleared = rm.clearFurniture('plaza');
  assert.equal(cleared.length, before);
  assert.equal(room.furniture.length, 0);
});

test('createDefaultRooms returns isolated state', () => {
  const r1 = createDefaultRooms(); const r2 = createDefaultRooms();
  assert.notEqual(r1.plaza.players, r2.plaza.players);
  assert.notEqual(r1.plaza.furniture, r2.plaza.furniture);
});
