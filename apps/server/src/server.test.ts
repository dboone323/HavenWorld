import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { SERVER_CONFIG } from './index';
import { moderateMessage, checkRateLimit, clearRateLimitEntry } from './services/ModerationService';
import { roomManager } from './services/RoomManager';

test('SERVER_CONFIG has valid defaults', () => {
  assert.equal(typeof SERVER_CONFIG.port, 'number');
  assert.ok(SERVER_CONFIG.port > 0 && SERVER_CONFIG.port < 65536);
  assert.ok(['development', 'production', 'test'].includes(SERVER_CONFIG.nodeEnv));
});

test('SOCKET_EVENTS contains all core and furniture events', () => {
  assert.equal(SOCKET_EVENTS.AUTH_JOIN, 'auth:join');
  assert.equal(SOCKET_EVENTS.AUTH_ERROR, 'auth:error');
  assert.equal(SOCKET_EVENTS.ROOM_STATE, 'room:state');
  assert.equal(SOCKET_EVENTS.ROOM_PLAYER_JOINED, 'room:player_joined');
  assert.equal(SOCKET_EVENTS.ROOM_PLAYER_LEFT, 'room:player_left');
  assert.equal(SOCKET_EVENTS.PLAYER_MOVE, 'player:move');
  assert.equal(SOCKET_EVENTS.PLAYER_POSITION, 'player:position');
  assert.equal(SOCKET_EVENTS.CHAT_SEND, 'chat:send');
  assert.equal(SOCKET_EVENTS.CHAT_MESSAGE, 'chat:message');
  assert.equal(SOCKET_EVENTS.CHAT_ERROR, 'chat:error');
  assert.equal(SOCKET_EVENTS.AVATAR_UPDATE, 'avatar:update');
  assert.equal(SOCKET_EVENTS.AVATAR_CHANGED, 'avatar:changed');
  assert.equal(SOCKET_EVENTS.FRIEND_ONLINE, 'friend:online');
  assert.equal(SOCKET_EVENTS.FRIEND_OFFLINE, 'friend:offline');
  // Part 5B Furniture events
  assert.equal(SOCKET_EVENTS.ROOM_FURNITURE_UPDATED, 'room:furniture_updated');
  assert.equal(SOCKET_EVENTS.FURNITURE_PLACE, 'furniture:place');
  assert.equal(SOCKET_EVENTS.FURNITURE_REMOVE, 'furniture:remove');
  assert.equal(Object.keys(SOCKET_EVENTS).length, 17);
});

test('Password hashing performs real bcrypt hash and verification', async () => {
  const plainPassword = 'HavenPassword123!';
  const hash = await bcrypt.hash(plainPassword, 10);
  assert.notEqual(hash, plainPassword);
  assert.ok(hash.startsWith('$2'));

  const isValid = await bcrypt.compare(plainPassword, hash);
  assert.equal(isValid, true);

  const isInvalid = await bcrypt.compare('WrongPassword456!', hash);
  assert.equal(isInvalid, false);
});

test('JWT signing and verification validates identity and detects tamper', () => {
  const secret = 'test-secret-key-havenworld-123456';
  const payload = { userId: 'user-uuid-1', username: 'Tester1', role: 'PLAYER' };
  const token = jwt.sign(payload, secret, { expiresIn: '15m' });

  assert.equal(typeof token, 'string');
  assert.ok(token.length > 20);

  const decoded = jwt.verify(token, secret) as typeof payload;
  assert.equal(decoded.userId, 'user-uuid-1');
  assert.equal(decoded.username, 'Tester1');
  assert.equal(decoded.role, 'PLAYER');

  assert.throws(() => {
    jwt.verify(token, 'wrong-secret-key-999');
  });
});

test('ModerationService filters profanity and preserves clean messages', () => {
  const clean = moderateMessage('Hello world, welcome to HavenWorld!');
  assert.equal(clean.wasFiltered, false);
  assert.equal(clean.severity, 'none');
  assert.equal(clean.filtered, 'Hello world, welcome to HavenWorld!');

  const dirty = moderateMessage('This is a damn test');
  assert.equal(dirty.wasFiltered, true);
  assert.ok(dirty.filtered.includes('*'));
  assert.equal(dirty.severity, 'mild');
});

test('ModerationService enforces rate limits per socket ID', () => {
  const socketId = 'sock-test-rate-limit-123';
  clearRateLimitEntry(socketId);

  // Send 5 messages (allowed limit)
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit(socketId, 5, 3000), true);
  }

  // 6th message exceeds limit
  assert.equal(checkRateLimit(socketId, 5, 3000), false);

  clearRateLimitEntry(socketId);
  // Reset allows message again
  assert.equal(checkRateLimit(socketId, 5, 3000), true);
  clearRateLimitEntry(socketId);
});

test('RoomManager manages in-memory player state, movement, and chat ring buffer', () => {
  const roomId = 'room-test-town-square';
  const socketId = 'socket-user-100';
  const player = {
    id: 'user-100',
    username: 'ExplorerDan',
    x: 100,
    y: 150,
    direction: 'down' as const,
    isMoving: false,
    avatar: { skinTone: 'light' },
    roomId,
  };

  roomManager.joinRoom(roomId, socketId, player);
  assert.equal(roomManager.getPlayerRoom(socketId), roomId);
  assert.equal(roomManager.getUserId(socketId), 'user-100');
  assert.equal(roomManager.getOccupantCount(roomId), 1);

  // Movement update with 3D coordinates
  roomManager.movePlayer(socketId, 132, 0, 'right', true, 85, 1.57);
  const updatedPlayer = roomManager.getRoomState(roomId)?.players.get(socketId);
  assert.equal(updatedPlayer?.x, 132);
  assert.equal(updatedPlayer?.y, 0);
  assert.equal(updatedPlayer?.z, 85);
  assert.equal(updatedPlayer?.rotY, 1.57);
  assert.equal(updatedPlayer?.direction, 'right');
  assert.equal(updatedPlayer?.isMoving, true);

  // Chat message ring buffer
  for (let i = 1; i <= 55; i++) {
    roomManager.addChatMessage(roomId, {
      id: `msg-${i}`,
      senderId: 'user-100',
      senderName: 'ExplorerDan',
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
      roomId,
    });
  }

  const chatHistory = roomManager.getRoomState(roomId)?.chatHistory;
  assert.equal(chatHistory?.length, 50);
  assert.equal(chatHistory?.[0].content, 'Message 6');
  assert.equal(chatHistory?.[49].content, 'Message 55');

  // Leave room
  const leaveResult = roomManager.leaveRoom(socketId);
  assert.equal(leaveResult?.roomId, roomId);
  assert.equal(leaveResult?.playerId, 'user-100');
  assert.equal(roomManager.getOccupantCount(roomId), 0);
});
