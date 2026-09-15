import test from 'node:test';
import assert from 'node:assert/strict';
import { stepToward, frameDt, fadeAlpha, lerp } from '../src/shared/movement.mjs';

test('stepToward moves toward target', () => {
  const p = { x: 0, y: 0, targetX: 10, targetY: 0, walkCycle: 0, isWalking: false };
  const r = stepToward(p, 1, 3.8);
  assert.equal(r.moved, true);
  assert.ok(p.x > 0);
  assert.equal(p.isWalking, true);
  assert.ok(p.walkCycle > 0);
});

test('stepToward snaps within the 0.05 threshold and resets walk', () => {
  const p = { x: 0, y: 0, targetX: 0.01, targetY: 0, walkCycle: 5, isWalking: true };
  const r = stepToward(p, 0.5, 3.8);
  assert.equal(r.snapped, true);
  assert.equal(p.x, 0.01);
  assert.equal(p.isWalking, false);
  assert.equal(p.walkCycle, 0);
});

test('stepToward overshoot is clamped to the target', () => {
  const p = { x: 0, y: 0, targetX: 1, targetY: 0, walkCycle: 0, isWalking: false };
  stepToward(p, 1, 3.8); // speed*dt = 3.8 > dist 1 -> clamps to target
  assert.equal(p.x, 1);
  assert.equal(p.y, 0);
});

test('frameDt clamps large deltas to 0.1s', () => {
  assert.equal(frameDt(2000, 1000), 0.1); // 1s -> clamped
  assert.equal(frameDt(1010, 1000), 0.01);
});

test('fadeAlpha lifetime / opacity curve', () => {
  assert.equal(fadeAlpha(7, 6, 5), -1);   // expired
  assert.equal(fadeAlpha(5.5, 6, 5), 0.5); // fading
  assert.equal(fadeAlpha(3), 1);          // opaque
  assert.equal(fadeAlpha(6, 6, 5), -1);   // exactly at lifetime -> expired
});

test('lerp interpolates linearly', () => {
  assert.equal(lerp(0, 100, 0.5), 50);
  assert.equal(lerp(10, 20, 0), 10);
});
