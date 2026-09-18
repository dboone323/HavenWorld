import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../src/shared/pathfinding.ts';

test('findPath returns direct point if start equals target', () => {
  const path = findPath({ x: 2, y: 3 }, { x: 2, y: 3 }, 12);
  assert.deepEqual(path, [{ x: 2, y: 3 }]);
});

test('findPath finds straight path on unblocked grid', () => {
  const path = findPath({ x: 1, y: 1 }, { x: 1, y: 4 }, 12);
  assert.equal(path.length, 4);
  assert.deepEqual(path[0], { x: 1, y: 1 });
  assert.deepEqual(path[path.length - 1], { x: 1, y: 4 });
});

test('findPath navigates around solid obstacles', () => {
  // Line of obstacles blocking direct path between (2, 2) and (2, 4)
  const obstacles = new Set(['2,3', '3,3']);
  const path = findPath({ x: 2, y: 2 }, { x: 2, y: 4 }, 12, obstacles);

  // Path must not pass through any obstacle
  for (const pt of path) {
    assert.equal(obstacles.has(`${pt.x},${pt.y}`), false, `point ${pt.x},${pt.y} should not be in obstacles`);
  }
  assert.deepEqual(path[0], { x: 2, y: 2 });
  assert.deepEqual(path[path.length - 1], { x: 2, y: 4 });
  // Path had to detour around
  assert.ok(path.length > 3);
});

test('findPath selects reachable neighbor when target is an obstacle', () => {
  const obstacles = new Set(['5,5']);
  const path = findPath({ x: 5, y: 3 }, { x: 5, y: 5 }, 12, obstacles);
  const destination = path[path.length - 1];

  assert.notEqual(`${destination.x},${destination.y}`, '5,5');
  const dist = Math.abs(destination.x - 5) + Math.abs(destination.y - 5);
  assert.equal(dist, 1, 'destination should be adjacent to target obstacle');
});
