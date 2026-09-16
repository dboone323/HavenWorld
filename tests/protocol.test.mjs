import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';

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
  const calls = {
    saveAvatar: 0, addCoins: 0, addFurniture: 0, removeFurniture: 0,
    savePlayerName: 0,
    getInventory: 0, addItem: 0, removeItem: 0,
    getFriends: 0, getPendingFriendRequests: 0, sendFriendRequest: 0,
    acceptFriendRequest: 0, areFriends: 0, saveMessage: 0, getMessages: 0,
  };
  const api = {
    saveAvatar: async () => { calls.saveAvatar++; },
    addCoins: async () => { calls.addCoins++; },
    addFurniture: async () => { calls.addFurniture++; },
    removeFurniture: async () => { calls.removeFurniture++; },
    getMode: () => 'memory', isConfigured: () => false,
    savePlayerName: async () => { calls.savePlayerName++; },
    getInventory: async () => { calls.getInventory++; return []; },
    addItem: async () => { calls.addItem++; },
    removeItem: async () => { calls.removeItem++; },
    getFriends: async () => { calls.getFriends++; return []; },
    getPendingFriendRequests: async () => { calls.getPendingFriendRequests++; return []; },
    sendFriendRequest: async () => { calls.sendFriendRequest++; return { success: true, message: 'Friend request sent!' }; },
    acceptFriendRequest: async () => { calls.acceptFriendRequest++; return { success: true, message: 'Friend request accepted!' }; },
    areFriends: async () => { calls.areFriends++; return false; },
    saveMessage: async () => { calls.saveMessage++; },
    getMessages: async () => { calls.getMessages++; return []; },
  };
  return { api, calls };
}
const C = (rooms, db, p, globalPlayers) => ({ rooms, db, ws: p.ws, globalPlayers });

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

test('GET_FRIENDS_LIST sends FRIENDS_LIST_UPDATE', async () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'GET_FRIENDS_LIST', payload: null }, p, C(rooms, api, p));
  // The handler is async — wait for promises to resolve
  await new Promise(r => setTimeout(r, 60));
  const msg = JSON.parse(p.ws.sent[0]);
  assert.equal(msg.type, 'FRIENDS_LIST_UPDATE');
  assert.ok(Array.isArray(msg.payload.friends));
  assert.ok(Array.isArray(msg.payload.pendingRequests));
});

test('GET_INVENTORY sends INVENTORY_UPDATE', async () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'GET_INVENTORY', payload: null }, p, C(rooms, api, p));
  await new Promise(r => setTimeout(r, 60));
  const msg = JSON.parse(p.ws.sent[0]);
  assert.equal(msg.type, 'INVENTORY_UPDATE');
});

test('GET_SHOP_CATALOG sends SHOP_CATALOG', () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const p = makePlayer('a'); rooms.join('plaza', p);
  handleMessage({ type: 'GET_SHOP_CATALOG', payload: null }, p, C(rooms, api, p));
  const msg = JSON.parse(p.ws.sent[0]);
  assert.equal(msg.type, 'SHOP_CATALOG');
  assert.ok(msg.payload.items);
});

test('BUY_ITEM deducts coins, adds inventory, sends updates', async () => {
  const rooms = new RoomManager();
  const { api, calls } = mockDb();
  const p = makePlayer('a', 'plaza'); p.coins = 1000; rooms.join('plaza', p);
  handleMessage({ type: 'BUY_ITEM', payload: { itemKey: 'sofa' } }, p, C(rooms, api, p));
  await new Promise(r => setTimeout(r, 60));
  assert.equal(p.coins, 500); // 1000 - 500
  assert.equal(calls.addCoins, 1);
  assert.equal(calls.addItem, 1);
  // Should have received COINS_UPDATED and INVENTORY_UPDATE
  const types = p.ws.sent.map(s => JSON.parse(s).type);
  assert.ok(types.includes('COINS_UPDATED'));
  assert.ok(types.includes('INVENTORY_UPDATE'));
});

test('BUY_ITEM rejects when not enough coins', () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const p = makePlayer('a'); p.coins = 10; rooms.join('plaza', p);
  handleMessage({ type: 'BUY_ITEM', payload: { itemKey: 'sofa' } }, p, C(rooms, api, p));
  const msg = JSON.parse(p.ws.sent[0]);
  assert.equal(msg.type, 'SHOP_ERROR');
  assert.ok(msg.payload.message.includes('Not enough'));
});

test('SEND_FRIEND_REQUEST looks up by name via globalPlayers', async () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const alice = makePlayer('a1'); alice.name = 'Alice'; rooms.join('plaza', alice);
  const bob = makePlayer('b1'); bob.name = 'Bob'; rooms.join('plaza', bob);
  const globalPlayers = new Map([['a1', alice], ['b1', bob]]);
  handleMessage({ type: 'SEND_FRIEND_REQUEST', payload: { targetName: 'Bob' } }, alice, C(rooms, api, alice, globalPlayers));
  await new Promise(r => setTimeout(r, 60));
  // Bob should have received FRIEND_REQUEST_RECEIVED
  const bobMsg = JSON.parse(bob.ws.sent[0]);
  assert.equal(bobMsg.type, 'FRIEND_REQUEST_RECEIVED');
  assert.equal(bobMsg.payload.fromPlayerName, 'Alice');
  // Alice should have received FRIEND_REQUEST_SENT
  const aliceMsg = JSON.parse(alice.ws.sent[0]);
  assert.equal(aliceMsg.type, 'FRIEND_REQUEST_SENT');
});

test('SEND_FRIEND_REQUEST errors on self', () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const p = makePlayer('a'); p.name = 'TestPlayer'; rooms.join('plaza', p);
  const globalPlayers = new Map([['a', p]]);
  handleMessage({ type: 'SEND_FRIEND_REQUEST', payload: { targetName: 'TestPlayer' } }, p, C(rooms, api, p, globalPlayers));
  const msg = JSON.parse(p.ws.sent[0]);
  assert.equal(msg.type, 'FRIEND_REQUEST_ERROR');
});

test('ACCEPT_FRIEND_REQUEST sends FRIEND_REQUEST_ACCEPTED to both parties', async () => {
  const rooms = new RoomManager();
  const { api } = mockDb();
  const alice = makePlayer('a1'); alice.name = 'Alice'; rooms.join('plaza', alice);
  const bob = makePlayer('b1'); bob.name = 'Bob'; rooms.join('plaza', bob);
  const globalPlayers = new Map([['a1', alice], ['b1', bob]]);
  handleMessage({ type: 'ACCEPT_FRIEND_REQUEST', payload: { requesterId: 'a1' } }, bob, C(rooms, api, bob, globalPlayers));
  await new Promise(r => setTimeout(r, 60));
  // Bob gets confirmation
  const bobMsg = JSON.parse(bob.ws.sent[0]);
  assert.equal(bobMsg.type, 'FRIEND_REQUEST_ACCEPTED');
  // Alice also gets confirmation
  const aliceMsg = JSON.parse(alice.ws.sent[0]);
  assert.equal(aliceMsg.type, 'FRIEND_REQUEST_ACCEPTED');
});

test('SEND_PRIVATE_MESSAGE sends PM to friend and echoes to sender', async () => {
  const rooms = new RoomManager();
  // Use a custom mock that returns true for areFriends
  let areFriendsResult = true;
  const calls = { saveMessage: 0 };
  const api = {
    getMode: () => 'memory', isConfigured: () => false, saveMessage: async () => { calls.saveMessage++; },
    areFriends: async () => areFriendsResult,
  };
  const alice = makePlayer('a1'); alice.name = 'Alice'; rooms.join('plaza', alice);
  const bob = makePlayer('b1'); bob.name = 'Bob'; rooms.join('plaza', bob);
  const globalPlayers = new Map([['a1', alice], ['b1', bob]]);
  handleMessage({ type: 'SEND_PRIVATE_MESSAGE', payload: { targetPlayerId: 'b1', text: 'Hello Bob!' } }, alice, C(rooms, api, alice, globalPlayers));
  await new Promise(r => setTimeout(r, 60));
  assert.equal(calls.saveMessage, 1);
  // Bob received PRIVATE_MESSAGE_RECEIVED
  const bobMsg = JSON.parse(bob.ws.sent[0]);
  assert.equal(bobMsg.type, 'PRIVATE_MESSAGE_RECEIVED');
  assert.equal(bobMsg.payload.text, 'Hello Bob!');
  assert.equal(bobMsg.payload.fromPlayerName, 'Alice');
  // Alice received echo
  const aliceMsg = JSON.parse(alice.ws.sent[0]);
  assert.equal(aliceMsg.type, 'PRIVATE_MESSAGE_RECEIVED');
});

test('SEND_PRIVATE_MESSAGE blocks non-friends', async () => {
  const rooms = new RoomManager();
  let areFriendsResult = false;
  const api = {
    getMode: () => 'memory', isConfigured: () => false,
    areFriends: async () => areFriendsResult,
  };
  const alice = makePlayer('a1'); rooms.join('plaza', alice);
  handleMessage({ type: 'SEND_PRIVATE_MESSAGE', payload: { targetPlayerId: 'b1', text: 'Hi' } }, alice, C(rooms, api, alice, new Map()));
  await new Promise(r => setTimeout(r, 60));
  const msg = JSON.parse(alice.ws.sent[0]);
  assert.equal(msg.type, 'PRIVATE_MESSAGE_ERROR');
  assert.ok(msg.payload.message.includes('friends'));
});
