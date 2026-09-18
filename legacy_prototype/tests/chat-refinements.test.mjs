import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceEmojiShortcodes, formatMeAction } from '../src/shared/chat.ts';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import * as db from '../src/server/db.ts';

function createRealClientSocket() {
  const sent = [];
  return {
    readyState: 1,
    send(data) {
      sent.push(typeof data === 'string' ? JSON.parse(data) : data);
    },
    sent,
  };
}

function createRealTestPlayer(id, name, room = 'plaza') {
  const ws = createRealClientSocket();
  return {
    id,
    name,
    room,
    x: 5,
    y: 5,
    targetX: 5,
    targetY: 5,
    coins: 1000,
    avatar: { skin: '#fff' },
    lastChat: null,
    ws,
    lastDailyClaim: 0,
    friends: [],
    authUserId: id,
  };
}

test('replaceEmojiShortcodes converts all Phase 1 standard shortcodes', () => {
  assert.equal(replaceEmojiShortcodes(':wave:'), '👋');
  assert.equal(replaceEmojiShortcodes(':heart:'), '💖');
  assert.equal(replaceEmojiShortcodes(':laugh:'), '😂');
  assert.equal(replaceEmojiShortcodes(':fire:'), '🔥');
  assert.equal(replaceEmojiShortcodes(':pizza:'), '🍕');
  assert.equal(replaceEmojiShortcodes(':coffee:'), '☕');
  assert.equal(replaceEmojiShortcodes(':sparkles:'), '✨');
  assert.equal(replaceEmojiShortcodes(':fish:'), '🎣');
  assert.equal(replaceEmojiShortcodes('Great catch :fish: and delicious :pizza:!'), 'Great catch 🎣 and delicious 🍕!');
});

test('formatMeAction constructs proper third-person action string', () => {
  assert.equal(formatMeAction('Daniel', 'celebrates a big catch'), '*Daniel celebrates a big catch*');
  assert.equal(formatMeAction('Traveler', 'sits down peacefully'), '*Traveler sits down peacefully*');
});

test('/me command in CHAT broadcasts formatted third-person action to room occupants', async () => {
  const rooms = new RoomManager();
  const alice = createRealTestPlayer('p_alice_me', 'Alice');
  const bob = createRealTestPlayer('p_bob_me', 'Bob');
  rooms.join('plaza', alice);
  rooms.join('plaza', bob);

  const context = {
    rooms,
    db,
    ws: alice.ws,
    dailyCooldownMs: 86400000,
  };

  await handleMessage({
    type: 'CHAT',
    payload: { text: '/me dances gracefully around the fountain' }
  }, alice, context);

  // Bob should receive CHAT_MESSAGE with formatted action text
  const bobMsg = bob.ws.sent.find(m => m.type === 'CHAT_MESSAGE');
  assert.ok(bobMsg, 'Bob received CHAT_MESSAGE for /me');
  assert.equal(bobMsg.payload.text, '*Alice dances gracefully around the fountain*');
  assert.equal(alice.lastChat?.text, '*Alice dances gracefully around the fountain*');
});

test('Chat rate limiter permits up to 5 messages per 3 seconds and blocks the 6th with RATE_LIMITED', async () => {
  const rooms = new RoomManager();
  const spammer = createRealTestPlayer('p_spammer', 'Spammer');
  rooms.join('plaza', spammer);

  const context = {
    rooms,
    db,
    ws: spammer.ws,
    dailyCooldownMs: 86400000,
  };

  // Send 5 messages in quick succession
  for (let i = 1; i <= 5; i++) {
    await handleMessage({
      type: 'CHAT',
      payload: { text: `Message number ${i}` }
    }, spammer, context);
  }

  // 6th message in the same 3-second window should trigger RATE_LIMITED
  await handleMessage({
    type: 'CHAT',
    payload: { text: 'Message number 6' }
  }, spammer, context);

  const errorMsg = spammer.ws.sent.find(m => m.type === 'CHAT_ERROR');
  assert.ok(errorMsg, 'Received CHAT_ERROR for exceeding rate limit');
  assert.equal(errorMsg.payload.code, 'RATE_LIMITED');
  assert.ok(errorMsg.payload.message.includes('Slow down'));
});
