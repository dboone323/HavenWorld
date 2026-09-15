import test from 'node:test';
import assert from 'node:assert/strict';
import { moderateChat, containsProfanity, redactPII, createRateLimiter, parseCommand } from '../src/server/moderation.js';

test('moderateChat trims and flags clean text as not-flagged', () => {
  const r = moderateChat('  hello  ');
  assert.equal(r.text, 'hello');
  assert.equal(r.flagged, false);
});

test('moderateChat caps over-long input', () => {
  const r = moderateChat('x'.repeat(200));
  assert.equal(r.text.length, 140);
});

test('moderateChat flags spambot', () => {
  assert.equal(containsProfanity('you are a spambot'), true);
  assert.equal(containsProfanity('hello friend'), false);
  const { flagged } = moderateChat('be a spambot');
  assert.equal(flagged, true);
});

test('redactPII masks emails and phone numbers', () => {
  const r = redactPII('mail a@b.com or call 555-123-4567');
  assert.equal(r.includes('a@b.com'), false);
  assert.equal(r.includes('555-123-4567'), false);
  assert.ok(r.includes('[redacted-email]'));
  assert.ok(r.includes('[redacted-phone]'));
});

test('rate limiter blocks after the limit within the window', () => {
  const rl = createRateLimiter(3, 60000);
  assert.equal(rl('p1').allowed, true);
  assert.equal(rl('p1').allowed, true);
  assert.equal(rl('p1').allowed, true);
  assert.equal(rl('p1').allowed, false);
  assert.equal(rl('p2').allowed, true); // isolated per key
});

test('moderateChat preserves /name command prefix', () => {
  const r = moderateChat('/name Rex');
  assert.equal(r.text.startsWith('/'), true);
});
