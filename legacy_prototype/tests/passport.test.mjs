import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSPORT_STAMPS,
  createDefaultPassport,
  recordPassportAction,
  getPassportProgress
} from '../src/client/shared/passport.js';

test('createDefaultPassport initializes state correctly', () => {
  const p = createDefaultPassport('usr_test123', 'Boone');
  assert.equal(p.playerId, 'usr_test123');
  assert.equal(p.playerName, 'Boone');
  assert.deepEqual(p.visitedRooms, ['plaza']);
  assert.deepEqual(p.unlockedStamps, {});
  assert.equal(p.stats.stepsTaken, 0);
});

test('recordPassportAction unlocks first_step stamp on initial step', () => {
  const p = createDefaultPassport('usr_1');
  const unlocked = recordPassportAction(p, 'STEP');
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].id, 'first_step');
  assert.ok(p.unlockedStamps.first_step > 0);

  // Subsequent steps should not re-unlock
  const unlocked2 = recordPassportAction(p, 'STEP');
  assert.equal(unlocked2.length, 0);
  assert.equal(p.stats.stepsTaken, 2);
});

test('recordPassportAction unlocks cozy_rest and light_switch', () => {
  const p = createDefaultPassport('usr_1');
  const sitUnlocked = recordPassportAction(p, 'SIT');
  assert.equal(sitUnlocked.length, 1);
  assert.equal(sitUnlocked[0].id, 'cozy_rest');

  const lightUnlocked = recordPassportAction(p, 'TOGGLE_LIGHT');
  assert.equal(lightUnlocked.length, 1);
  assert.equal(lightUnlocked[0].id, 'light_switch');
});

test('recordPassportAction unlocks pizza_artisan only on qualifying score', () => {
  const p = createDefaultPassport('usr_1');
  const lowScore = recordPassportAction(p, 'MINIGAME_SCORE', { score: 50 });
  assert.equal(lowScore.length, 0);
  assert.equal(p.unlockedStamps.pizza_artisan, undefined);

  const highScore = recordPassportAction(p, 'MINIGAME_SCORE', { score: 150 });
  assert.equal(highScore.length, 1);
  assert.equal(highScore[0].id, 'pizza_artisan');
});

test('recordPassportAction unlocks world_traveler when visiting multiple rooms', () => {
  const p = createDefaultPassport('usr_1');
  recordPassportAction(p, 'ENTER_ROOM', { roomId: 'plaza' }); // already visited
  assert.equal(p.unlockedStamps.world_traveler, undefined);

  const travelUnlocked = recordPassportAction(p, 'ENTER_ROOM', { roomId: 'loft_abc' });
  assert.equal(travelUnlocked.length, 1);
  assert.equal(travelUnlocked[0].id, 'world_traveler');
  assert.equal(p.visitedRooms.length, 2);
});

test('getPassportProgress computes completion percentages', () => {
  const p = createDefaultPassport('usr_1');
  let prog = getPassportProgress(p);
  assert.equal(prog.unlockedCount, 0);
  assert.equal(prog.percent, 0);

  recordPassportAction(p, 'SIT');
  recordPassportAction(p, 'TOGGLE_LIGHT');
  prog = getPassportProgress(p);
  assert.equal(prog.unlockedCount, 2);
  const expectedPercent = Math.round((2 / Object.keys(PASSPORT_STAMPS).length) * 100);
  assert.equal(prog.percent, expectedPercent);
});
