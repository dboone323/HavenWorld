import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeJumpOffset,
  computeWaveAngle,
  computeDanceOffset,
  computeShadowScale,
} from '../src/shared/emotes.ts';

test('computeJumpOffset returns parabolic trajectory', () => {
  // Start of jump: 0 offset
  const start = computeJumpOffset(0, 20);
  assert.equal(start, 0);

  // Peak of jump at 50%: should reach -maxHeight exactly
  const peak = computeJumpOffset(0.5, 20);
  assert.equal(peak, -20);

  // Quarter-way through: should be symmetric
  const quarter = computeJumpOffset(0.25, 20);
  const threeQuarter = computeJumpOffset(0.75, 20);
  assert.equal(quarter, -15);
  assert.equal(threeQuarter, -15);

  // End of jump: 0 offset
  const end = computeJumpOffset(1.0, 20);
  assert.equal(end, 0);

  // Out of bounds progress clamping
  assert.equal(computeJumpOffset(-0.5, 20), 0);
  assert.equal(computeJumpOffset(1.5, 20), 0);
});

test('computeWaveAngle oscillates within degree bounds', () => {
  const maxAngle = 0.45;
  const cycles = 3;

  // Start at 0 radians
  const start = computeWaveAngle(0, maxAngle, cycles);
  assert.ok(Math.abs(start) < 1e-6);

  // Check peak positive and negative swings
  let minObserved = 0;
  let maxObserved = 0;
  for (let i = 0; i <= 60; i++) {
    const angle = computeWaveAngle(i / 60, maxAngle, cycles);
    if (angle < minObserved) minObserved = angle;
    if (angle > maxObserved) maxObserved = angle;
  }

  assert.ok(maxObserved > 0.4, 'wave angle reaches positive peak amplitude');
  assert.ok(minObserved < -0.4, 'wave angle reaches negative peak amplitude');
  assert.ok(maxObserved <= maxAngle + 1e-6, 'wave angle never exceeds max amplitude');
});

test('computeDanceOffset provides lateral sway and rhythmic bounce', () => {
  const maxSway = 6;
  const cycles = 2;

  const start = computeDanceOffset(0, maxSway, cycles);
  assert.equal(start.x, 0);
  assert.equal(start.y, 0);

  let maxSwaySeen = 0;
  let hasBounced = false;

  for (let i = 0; i <= 40; i++) {
    const { x, y } = computeDanceOffset(i / 40, maxSway, cycles);
    if (Math.abs(x) > maxSwaySeen) maxSwaySeen = Math.abs(x);
    if (y < -1) hasBounced = true;
  }

  assert.ok(maxSwaySeen > 5.5, 'dance sway approaches maxSway');
  assert.ok(hasBounced, 'dance includes rhythmic foot bounce');
});

test('computeShadowScale scales ground shadow inversely with jump elevation', () => {
  // On ground (jumpOffset = 0): full shadow size (1.0)
  assert.equal(computeShadowScale(0, 20, 0.55), 1.0);

  // At peak height (jumpOffset = -20): minimal shadow size (0.55)
  assert.equal(computeShadowScale(-20, 20, 0.55), 0.55);

  // Mid-flight (jumpOffset = -10): linear interpolation between 1.0 and 0.55
  const midScale = computeShadowScale(-10, 20, 0.55);
  assert.ok(Math.abs(midScale - 0.775) < 1e-4);

  // Clamped bounds if offset exceeds maxHeight
  const overJump = computeShadowScale(-30, 20, 0.55);
  assert.equal(overJump, 0.55);
});
