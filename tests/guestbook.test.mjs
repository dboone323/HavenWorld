import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuestbookEntry,
  addGuestbookEntry,
  validateTip
} from '../src/server/guestbook.ts';

test('createGuestbookEntry validates text and trims', () => {
  const empty = createGuestbookEntry('u1', 'Alice', '   ');
  assert.equal(empty, null);

  const valid = createGuestbookEntry('u1', 'Alice', '  Love your cozy loft!  ');
  assert.ok(valid);
  assert.equal(valid.message, 'Love your cozy loft!');
  assert.equal(valid.senderName, 'Alice');
});

test('addGuestbookEntry caps maximum history size', () => {
  let entries = [];
  for (let i = 0; i < 55; i++) {
    const e = createGuestbookEntry('u1', 'Alice', `Note ${i}`);
    entries = addGuestbookEntry(entries, e, 50);
  }
  assert.equal(entries.length, 50);
  // Most recent should be at the front
  assert.equal(entries[0].message, 'Note 54');
});

test('validateTip enforces limits and balance checks', () => {
  // Below min
  assert.equal(validateTip(1000, 5).valid, false);

  // Above max
  assert.equal(validateTip(1000, 600).valid, false);

  // Insufficient balance
  assert.equal(validateTip(50, 100).valid, false);

  // Valid tip
  const valid = validateTip(500, 50);
  assert.equal(valid.valid, true);
  assert.equal(valid.amount, 50);
});
