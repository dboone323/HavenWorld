import test from 'node:test';
import assert from 'node:assert/strict';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { SERVER_CONFIG } from './index.js';

test('SERVER_CONFIG has valid defaults', () => {
  assert.equal(typeof SERVER_CONFIG.port, 'number');
  assert.ok(SERVER_CONFIG.port > 0 && SERVER_CONFIG.port < 65536);
  assert.ok(['development', 'production', 'test'].includes(SERVER_CONFIG.nodeEnv));
});

test('SOCKET_EVENTS contains all 14 Part 3 Section 5.2 events', () => {
  // Auth
  assert.equal(SOCKET_EVENTS.AUTH_JOIN,  'auth:join');
  assert.equal(SOCKET_EVENTS.AUTH_ERROR, 'auth:error');

  // Room
  assert.equal(SOCKET_EVENTS.ROOM_STATE,         'room:state');
  assert.equal(SOCKET_EVENTS.ROOM_PLAYER_JOINED,  'room:player_joined');
  assert.equal(SOCKET_EVENTS.ROOM_PLAYER_LEFT,    'room:player_left');

  // Player
  assert.equal(SOCKET_EVENTS.PLAYER_MOVE,     'player:move');
  assert.equal(SOCKET_EVENTS.PLAYER_POSITION, 'player:position');

  // Chat
  assert.equal(SOCKET_EVENTS.CHAT_SEND,    'chat:send');
  assert.equal(SOCKET_EVENTS.CHAT_MESSAGE, 'chat:message');
  assert.equal(SOCKET_EVENTS.CHAT_ERROR,   'chat:error');

  // Avatar
  assert.equal(SOCKET_EVENTS.AVATAR_UPDATE,  'avatar:update');
  assert.equal(SOCKET_EVENTS.AVATAR_CHANGED, 'avatar:changed');

  // Friends
  assert.equal(SOCKET_EVENTS.FRIEND_ONLINE,  'friend:online');
  assert.equal(SOCKET_EVENTS.FRIEND_OFFLINE, 'friend:offline');

  // Confirm exactly 14 events
  assert.equal(Object.keys(SOCKET_EVENTS).length, 14);
});
