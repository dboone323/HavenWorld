import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-invite-')), 'test.db');

const db = await import(new URL('../src/server/db.ts', import.meta.url));

test('createInviteCode creates a valid record with custom options', async () => {
  const custom = await db.createInviteCode({
    code: 'ALPHA-CUSTOM-2026',
    createdBy: 'test_admin',
    maxUses: 2
  });

  assert.equal(custom.code, 'ALPHA-CUSTOM-2026');
  assert.equal(custom.created_by, 'test_admin');
  assert.equal(custom.max_uses, 2);
  assert.equal(custom.uses, 0);

  const check = await db.validateInviteCode('ALPHA-CUSTOM-2026');
  assert.equal(check.valid, true);
  assert.ok(check.invite);
  assert.equal(check.invite.code, 'ALPHA-CUSTOM-2026');
});

test('createInviteCode auto-generates code when omitted', async () => {
  const auto = await db.createInviteCode({ maxUses: 1 });
  assert.ok(auto.code.startsWith('HAVEN-'));
  assert.equal(auto.max_uses, 1);
  assert.equal(auto.uses, 0);

  const check = await db.validateInviteCode(auto.code);
  assert.equal(check.valid, true);
});

test('validateInviteCode rejects nonexistent and blank codes', async () => {
  const empty = await db.validateInviteCode('');
  assert.equal(empty.valid, false);

  const missing = await db.validateInviteCode('NONEXISTENT-CODE-1234');
  assert.equal(missing.valid, false);
  assert.match(missing.reason, /invalid/i);
});

test('validateInviteCode rejects expired codes', async () => {
  const pastDate = new Date(Date.now() - 10000).toISOString();
  await db.createInviteCode({
    code: 'EXPIRED-TEST-CODE',
    expiresAt: pastDate,
    maxUses: 5
  });

  const check = await db.validateInviteCode('EXPIRED-TEST-CODE');
  assert.equal(check.valid, false);
  assert.match(check.reason, /expired/i);
});

test('consumeInviteCode tracks usage and enforces max_uses', async () => {
  await db.createInviteCode({
    code: 'TWO-USES-ONLY',
    maxUses: 2
  });

  // First use
  const consume1 = await db.consumeInviteCode('TWO-USES-ONLY', 'usr_tester_1');
  assert.equal(consume1.success, true);

  const check1 = await db.validateInviteCode('TWO-USES-ONLY');
  assert.equal(check1.valid, true);
  assert.equal(check1.invite.uses, 1);

  // Second use
  const consume2 = await db.consumeInviteCode('TWO-USES-ONLY', 'usr_tester_2');
  assert.equal(consume2.success, true);

  // Third use should fail because max_uses (2) reached
  const check2 = await db.validateInviteCode('TWO-USES-ONLY');
  assert.equal(check2.valid, false);
  assert.match(check2.reason, /maximum usage/i);

  const consume3 = await db.consumeInviteCode('TWO-USES-ONLY', 'usr_tester_3');
  assert.equal(consume3.success, false);
});

test('listInviteCodes returns sorted list of all generated codes', async () => {
  const list = await db.listInviteCodes();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 3);
  assert.ok(list.some(c => c.code === 'ALPHA-CUSTOM-2026'));
});

after(() => {
  if (typeof db.close === 'function') {
    db.close();
  }
});
