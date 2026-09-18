import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleIdentity, identityFor } from '../src/server/identity.ts';
import { handleMessage } from '../src/server/protocol.ts';
import { RoomManager } from '../src/server/rooms.ts';
import { TITLES } from '../src/client/shared/identity-model.js';

function makeRealDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY,
      coins INTEGER DEFAULT 1000,
      gems INTEGER DEFAULT 10,
      avatar_json TEXT,
      identity_json TEXT,
      last_daily_bonus INTEGER DEFAULT 0,
      last_room TEXT DEFAULT 'plaza',
      last_x REAL DEFAULT 5,
      last_y REAL DEFAULT 5,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_friends (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, friend_id)
    );
    INSERT INTO users (id, username, password_hash) VALUES ('u_status_1', 'ChefAlice', 'hash');
    INSERT INTO user_profiles (id) VALUES ('u_status_1');
  `);

  return {
    async saveIdentity(playerId, identity) {
      db.prepare(`
        INSERT INTO user_profiles (id, identity_json) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET identity_json = excluded.identity_json, updated_at = CURRENT_TIMESTAMP
      `).run(playerId, JSON.stringify(identity));
    },
    async loadIdentity(playerId) {
      const row = db.prepare('SELECT identity_json FROM user_profiles WHERE id = ?').get(playerId);
      return row?.identity_json ? JSON.parse(row.identity_json) : null;
    },
    async getFriends() { return []; },
    async savePlayerName() {},
    getMode() { return 'sqlite'; },
    isConfigured() { return true; },
  };
}

function makeFakeSocket() {
  const sent = [];
  return {
    sent,
    readyState: 1, // OPEN
    send(str) { sent.push(str); },
  };
}

test('UPDATE_IDENTITY updates custom status message and persists to real SQLite database', async () => {
  const realDb = makeRealDb();
  const rooms = new RoomManager();
  const ws = makeFakeSocket();
  const player = {
    id: 'u_status_1',
    name: 'ChefAlice',
    room: 'plaza',
    x: 5, y: 5, targetX: 5, targetY: 5,
    facing: 'SE',
    coins: 1000, gems: 10,
    avatar: {},
    ws,
    authUserId: 'u_status_1',
    friends: [],
  };
  rooms.join('plaza', player);

  const ctx = {
    rooms,
    db: realDb,
    ws,
    globalPlayers: new Map([[player.id, player]]),
  };

  // 1. Update status via handleIdentity
  const handled = await handleIdentity(
    'UPDATE_IDENTITY',
    { statusMessage: 'Baking fresh artisan pizzas 🍕' },
    player,
    ctx
  );
  assert.equal(handled, true);

  // 2. Verify state on player object
  const state = identityFor(player);
  assert.equal(state.statusMessage, 'Baking fresh artisan pizzas 🍕');

  // 3. Verify socket message sent
  const idMsg = ws.sent.map(s => JSON.parse(s)).find(m => m.type === 'IDENTITY_UPDATED');
  assert.ok(idMsg);
  assert.equal(idMsg.payload.statusMessage, 'Baking fresh artisan pizzas 🍕');

  // 4. Verify persisted to SQLite
  const loaded = await realDb.loadIdentity('u_status_1');
  assert.ok(loaded);
  assert.equal(loaded.statusMessage, 'Baking fresh artisan pizzas 🍕');
});

test('Protocol CHAT /status updates player status message', async () => {
  const realDb = makeRealDb();
  const rooms = new RoomManager();
  const ws = makeFakeSocket();
  const player = {
    id: 'u_status_1',
    name: 'ChefAlice',
    room: 'plaza',
    x: 5, y: 5, targetX: 5, targetY: 5,
    facing: 'SE',
    coins: 1000, gems: 10,
    avatar: {},
    ws,
    authUserId: 'u_status_1',
    friends: [],
  };
  rooms.join('plaza', player);

  const ctx = {
    rooms,
    db: realDb,
    ws,
    globalPlayers: new Map([[player.id, player]]),
  };

  await handleMessage(
    { type: 'CHAT', payload: { text: '/status Chilling in the Plaza lounge' } },
    player,
    ctx
  );

  const state = identityFor(player);
  assert.equal(state.statusMessage, 'Chilling in the Plaza lounge');
});

test('Hover tooltip formats player title and custom status subtitle correctly', () => {
  // Test formatting logic matching drawTooltip implementation
  function formatHoverTooltip(p) {
    const titleLabel = TITLES[p.title]?.label;
    const statusText = p.statusMessage || p.identity?.statusMessage;
    return {
      title: `${titleLabel ? `[${titleLabel}] ` : ''}${p.name || 'Traveler'}`,
      hint: statusText ? `“${statusText}”` : 'Click to open player menu',
    };
  }

  // Case A: Chef with custom status
  const p1 = { name: 'Alice', title: 'chef', statusMessage: 'Baking pizzas 🍕' };
  const t1 = formatHoverTooltip(p1);
  assert.equal(t1.title, '[Chef] Alice');
  assert.equal(t1.hint, '“Baking pizzas 🍕”');

  // Case B: Traveler with no custom status
  const p2 = { name: 'Bob', title: 'traveler' };
  const t2 = formatHoverTooltip(p2);
  assert.equal(t2.title, '[The Traveler] Bob');
  assert.equal(t2.hint, 'Click to open player menu');

  // Case C: Standard traveler with no title and no status
  const p3 = { name: 'Charlie' };
  const t3 = formatHoverTooltip(p3);
  assert.equal(t3.title, 'Charlie');
  assert.equal(t3.hint, 'Click to open player menu');
});
