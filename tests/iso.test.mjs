import test from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, toGrid, clampGrid, isInGrid, DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT } from '../src/shared/iso.mjs';

test('toScreen places origin at pivot for grid (0,0)', () => {
  assert.deepEqual(toScreen(0, 0, 400, 200), { x: 400, y: 200 });
});

test('toScreen shifts a positive grid cell diagonally', () => {
  assert.deepEqual(toScreen(1, 0, 0, 0, 64, 32), { x: 32, y: 16 });
  assert.deepEqual(toScreen(0, 1, 0, 0, 64, 32), { x: -32, y: 16 });
});

test('toGrid is the inverse of toScreen', () => {
  const s = toScreen(3, 5, 400, 200);
  const g = toGrid(s.x, s.y, 400, 200);
  assert.ok(Math.abs(g.x - 3) < 1e-6 && Math.abs(g.y - 5) < 1e-6);
});

test('clampGrid bounds to [0, size]', () => {
  assert.equal(clampGrid(-1, 11), 0);
  assert.equal(clampGrid(12, 11), 11);
  assert.equal(clampGrid(5, 11), 5);
});

test('isInGrid respects the grid size', () => {
  assert.equal(isInGrid(0, 0, 11), true);
  assert.equal(isInGrid(11, 11, 11), true);
  assert.equal(isInGrid(12, 0, 11), false);
  assert.equal(isInGrid(-1, 0, 11), false);
});

test('defaults are exported', () => {
  assert.equal(DEFAULT_TILE_WIDTH, 64);
  assert.equal(DEFAULT_TILE_HEIGHT, 32);
});
