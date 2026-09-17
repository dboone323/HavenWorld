/**
 * HavenWorld — Real Functional Unit Tests for Web Audio Engine
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_FREQUENCIES,
  computeDecayEnvelope,
  computePitchRamp,
  setMuted,
  getMuted,
  toggleMuted
} from '../src/client/shared/audio.js';

test('NOTE_FREQUENCIES exports standard pitch values', () => {
  assert.equal(NOTE_FREQUENCIES.A4, 440.00);
  assert.equal(NOTE_FREQUENCIES.C4, 261.63);
  assert.equal(NOTE_FREQUENCIES.E5, 659.25);
  assert.equal(NOTE_FREQUENCIES.B5, 987.77);
  assert.equal(NOTE_FREQUENCIES.C6, 1046.50);
});

test('computeDecayEnvelope generates decreasing exponential points', () => {
  const env = computeDecayEnvelope(0.2, 0.5);
  assert.ok(Array.isArray(env));
  assert.ok(env.length >= 6);
  // First point should equal peakGain
  assert.equal(env[0].t, 0);
  assert.equal(Math.round(env[0].gain * 100) / 100, 0.2);
  // Last point should be significantly decayed
  const last = env[env.length - 1];
  assert.equal(Math.round(last.t * 100) / 100, 0.5);
  assert.ok(last.gain < 0.05, `gain ${last.gain} should decay well below 0.05`);
  // All points should strictly decrease in gain
  for (let i = 1; i < env.length; i++) {
    assert.ok(env[i].gain <= env[i - 1].gain, `step ${i} gain should be <= previous`);
  }
});

test('computeDecayEnvelope handles zero or negative duration safely', () => {
  const env = computeDecayEnvelope(0.2, 0);
  assert.deepEqual(env, [{ t: 0, gain: 0 }]);
});

test('computePitchRamp produces linear frequency steps', () => {
  const ramp = computePitchRamp(400, 100, 0.1, 4);
  assert.equal(ramp.length, 5);
  assert.equal(ramp[0].freq, 400);
  assert.equal(ramp[4].freq, 100);
  assert.equal(ramp[2].freq, 250); // midpoint
});

test('mute toggling updates state consistently', () => {
  setMuted(false);
  assert.equal(getMuted(), false);
  const toggled = toggleMuted();
  assert.equal(toggled, true);
  assert.equal(getMuted(), true);
  setMuted(false);
  assert.equal(getMuted(), false);
});
