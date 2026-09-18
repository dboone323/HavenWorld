import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FISH_SPECIES,
  rollCatch,
  updateProgress,
  generateWeight
} from '../src/client/shared/fishing.js';

test('FISH_SPECIES defines expected rarities and values', () => {
  assert.equal(FISH_SPECIES.pond_guppy.coins, 35);
  assert.equal(FISH_SPECIES.haven_koi.coins, 350);
  assert.equal(FISH_SPECIES.haven_koi.rarity, 'legendary');
});

test('rollCatch respects weighted probability distribution', () => {
  assert.equal(rollCatch(0.1).id, 'pond_guppy');
  assert.equal(rollCatch(0.49).id, 'pond_guppy');
  assert.equal(rollCatch(0.65).id, 'cozy_tetra');
  assert.equal(rollCatch(0.85).id, 'golden_perch');
  assert.equal(rollCatch(0.98).id, 'haven_koi');
});

test('updateProgress advances in zone and retreats outside zone', () => {
  let p = 50;
  // 1s in zone adds 35
  p = updateProgress(p, true, 1.0);
  assert.equal(p, 85);

  // 1s outside zone removes 20
  p = updateProgress(p, false, 1.0);
  assert.equal(p, 65);

  // Clamps at 100
  p = updateProgress(95, true, 1.0);
  assert.equal(p, 100);

  // Clamps at 0
  p = updateProgress(10, false, 1.0);
  assert.equal(p, 0);
});

test('generateWeight scales within species bounds', () => {
  const koi = FISH_SPECIES.haven_koi;
  const minW = generateWeight(koi, 0.0);
  assert.equal(minW, koi.minWeight);

  const maxW = generateWeight(koi, 1.0);
  assert.equal(maxW, koi.maxWeight);

  const midW = generateWeight(koi, 0.5);
  assert.ok(midW >= koi.minWeight && midW <= koi.maxWeight);
});
