import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridDistance,
  isWithinAudibleDistance,
  computeVolumeFalloff,
  filterAudibleListeners,
  DEFAULT_AUDIBLE_RADIUS,
  DEFAULT_SHOUT_RADIUS
} from '../src/shared/spatial.ts';

test('gridDistance computes true Euclidean distance in 2D grid space', () => {
  assert.equal(gridDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(gridDistance({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
  assert.ok(Math.abs(gridDistance({ x: 1, y: 2 }, { x: 4, y: 6 }) - 5) < 1e-6);
});

test('isWithinAudibleDistance respects audible boundaries and handles non-finite coordinates', () => {
  const speaker = { x: 5, y: 5 };
  const closeListener = { x: 8, y: 5 }; // distance = 3 <= 7
  const edgeListener = { x: 12, y: 5 }; // distance = 7 <= 7
  const farListener = { x: 15, y: 15 }; // distance = 14.14 > 7

  assert.equal(isWithinAudibleDistance(speaker, closeListener), true);
  assert.equal(isWithinAudibleDistance(speaker, edgeListener), true);
  assert.equal(isWithinAudibleDistance(speaker, farListener), false);

  // Far listener is audible with shout radius
  assert.equal(isWithinAudibleDistance(speaker, farListener, DEFAULT_SHOUT_RADIUS), false); // 14.14 > 14.0
  const shoutListener = { x: 15, y: 5 }; // distance = 10 <= 14
  assert.equal(isWithinAudibleDistance(speaker, shoutListener, DEFAULT_SHOUT_RADIUS), true);

  // Non-finite guards
  assert.equal(isWithinAudibleDistance(speaker, { x: NaN, y: 5 }), false);
  assert.equal(isWithinAudibleDistance({ x: Infinity, y: 0 }, closeListener), false);
});

test('computeVolumeFalloff provides smooth non-linear attenuation', () => {
  assert.equal(computeVolumeFalloff(0, 10), 1.0);
  assert.equal(computeVolumeFalloff(10, 10), 0.0);
  assert.equal(computeVolumeFalloff(15, 10), 0.0);

  const mid = computeVolumeFalloff(5, 10);
  assert.ok(mid > 0 && mid < 1.0, 'midpoint volume is within (0, 1)');
  assert.ok(Math.abs(mid - 0.25) < 1e-6, 'quadratic ease-out at 50% radius is 0.25');
});

test('filterAudibleListeners filters a list of occupants to only audible recipients', () => {
  const speaker = { id: 'p1', x: 5, y: 5 };
  const listeners = [
    speaker,
    { id: 'p2', x: 7, y: 6 }, // dist = ~2.23 (audible)
    { id: 'p3', x: 10, y: 10 }, // dist = ~7.07 (out of 7.0 range)
    { id: 'p4', x: 6, y: 5 }, // dist = 1.0 (audible)
  ];

  const audible = filterAudibleListeners(speaker, listeners, DEFAULT_AUDIBLE_RADIUS);
  const ids = audible.map(p => p.id);
  assert.deepEqual(ids, ['p1', 'p2', 'p4']);
});
