import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-fish-test-')), 'test.db');

const db = await import(new URL('../src/server/db.ts', import.meta.url));
const { RoomManager } = await import(new URL('../src/server/rooms.ts', import.meta.url));
const { handleMessage } = await import(new URL('../src/server/protocol.ts', import.meta.url));
const { FISH_SPECIES, rollCatch, updateProgress, generateWeight } = await import(new URL('../src/shared/fishing.ts', import.meta.url));

function createTestSocket() {
  const sent = [];
  return {
    readyState: 1,
    send(data) {
      try {
        sent.push(JSON.parse(data));
      } catch {
        sent.push(data);
      }
    },
    sent
  };
}

test('Shared fishing module produces accurate species, rarities, and weights', () => {
  assert.ok(FISH_SPECIES.pond_guppy);
  assert.ok(FISH_SPECIES.cozy_tetra);
  assert.ok(FISH_SPECIES.golden_perch);
  assert.ok(FISH_SPECIES.haven_koi);

  const guppy = rollCatch(0.1);
  assert.equal(guppy.id, 'pond_guppy');
  assert.equal(guppy.rarity, 'common');

  const koi = rollCatch(0.99);
  assert.equal(koi.id, 'haven_koi');
  assert.equal(koi.rarity, 'legendary');

  const weight = generateWeight(koi, 0.5);
  assert.ok(weight >= koi.minWeight && weight <= koi.maxWeight);

  let p = 30;
  p = updateProgress(p, true, 0.5);
  assert.equal(p, 47.5);
  p = updateProgress(p, false, 0.5);
  assert.equal(p, 37.5);
});

test('handleMessage FISHING_CATCH credits coins and sends FISHING_CATCH_RESULT', async () => {
  const rooms = new RoomManager();
  const socket = createTestSocket();
  const player = {
    id: 'usr_angler_1',
    name: 'AnglerDan',
    room: 'plaza',
    x: 4.5,
    y: 7.5,
    targetX: 4.5,
    targetY: 7.5,
    coins: 1000,
    gems: 50,
    avatar: { skin: '#f5cba7' },
    lastChat: null,
    ws: socket,
    lastDailyClaim: 0,
    friends: [],
    authUserId: 'usr_angler_1'
  };

  await db.initPlayerProfile(player.id, player.name);
  rooms.join('plaza', player);

  const ctx = {
    rooms,
    db,
    ws: socket,
    globalPlayers: new Map([[player.id, player]]),
    tradeManager: null,
    dailyCooldownMs: 86400000
  };

  // 1. Send FISHING_CATCH with fixed rolls (guarantees haven_koi)
  await handleMessage({
    type: 'FISHING_CATCH',
    payload: { roll: 0.98, weightRoll: 0.8 }
  }, player, ctx);

  const catchResult = socket.sent.find(m => m.type === 'FISHING_CATCH_RESULT');
  assert.ok(catchResult, 'FISHING_CATCH_RESULT was sent to player');
  assert.equal(catchResult.payload.success, true);
  assert.equal(catchResult.payload.fish.id, 'haven_koi');
  assert.equal(catchResult.payload.coinsEarned, 350);
  assert.equal(player.coins, 1350);

  const coinsUpdate = socket.sent.find(m => m.type === 'COINS_UPDATED');
  assert.ok(coinsUpdate, 'COINS_UPDATED was sent to player');
  assert.equal(coinsUpdate.payload.coins, 1350);

  // Verify coins persisted in real SQLite DB
  const profile = await db.loadPlayerProfile(player.id);
  assert.equal(profile.coins, 1350);

  // 2. Anti-exploit cooldown: immediate second catch must be rejected
  await handleMessage({
    type: 'FISHING_CATCH',
    payload: { roll: 0.1, weightRoll: 0.1 }
  }, player, ctx);

  const rateLimitMsg = socket.sent.find(m => m.type === 'SYSTEM_MESSAGE' && m.payload?.text?.includes('too fast'));
  assert.ok(rateLimitMsg, 'Rapid-fire cast was rate-limited by authoritative server');
});

after(() => {
  if (typeof db.close === 'function') {
    db.close();
  }
});
