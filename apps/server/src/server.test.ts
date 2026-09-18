import test from 'node:test';
import assert from 'node:assert/strict';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { SERVER_CONFIG } from './index.js';

test('SERVER_CONFIG has valid defaults', () => {
  assert.equal(typeof SERVER_CONFIG.port, 'number');
  assert.ok(SERVER_CONFIG.port > 0 && SERVER_CONFIG.port < 65536);
  assert.ok(['development', 'production', 'test'].includes(SERVER_CONFIG.nodeEnv));
});

test('SOCKET_EVENTS contains required multiplayer lifecycle and room events', () => {
  assert.equal(SOCKET_EVENTS.CONNECT, 'connect');
  assert.equal(SOCKET_EVENTS.DISCONNECT, 'disconnect');
  assert.equal(SOCKET_EVENTS.ROOM_JOIN, 'room:join');
  assert.equal(SOCKET_EVENTS.PLAYER_MOVE, 'player:move');
  assert.equal(SOCKET_EVENTS.CHAT_MESSAGE, 'chat:message');
  assert.ok(Object.keys(SOCKET_EVENTS).length >= 10);
});
