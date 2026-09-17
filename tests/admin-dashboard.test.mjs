import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-admin-test-')), 'test.db');
process.env.ADMIN_SECRET = 'test_secret_key_456';
process.env.HAVEN_NO_TICK = '1';

const { app, server } = await import(new URL('../src/server/server.ts', import.meta.url));
const db = await import(new URL('../src/server/db.ts', import.meta.url));

let baseUrl;
let httpServer;

before(async () => {
  await new Promise((resolve) => {
    httpServer = server.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  if (typeof db.close === 'function') {
    db.close();
  }
});

test('GET /terms and /privacy return 200 and legal HTML', async () => {
  const termsRes = await fetch(`${baseUrl}/terms`);
  assert.equal(termsRes.status, 200);
  const termsHtml = await termsRes.text();
  assert.match(termsHtml, /Terms of Service/i);
  assert.match(termsHtml, /Alpha/i);

  const privacyRes = await fetch(`${baseUrl}/privacy`);
  assert.equal(privacyRes.status, 200);
  const privacyHtml = await privacyRes.text();
  assert.match(privacyHtml, /Privacy Policy/i);
  assert.match(privacyHtml, /GDPR/i);
});

test('GET /admin renders the admin dashboard HTML', async () => {
  const adminRes = await fetch(`${baseUrl}/admin`);
  assert.equal(adminRes.status, 200);
  const adminHtml = await adminRes.text();
  assert.match(adminHtml, /HavenWorld Moderation/i);
  assert.match(adminHtml, /Alpha Invites/i);
});

test('Admin API endpoints reject unauthorized requests with 401', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/admin/overview`);
  assert.equal(unauthRes.status, 401);

  const wrongSecretRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { 'x-admin-secret': 'wrong_secret' }
  });
  assert.equal(wrongSecretRes.status, 401);
});

test('Admin API endpoints accept valid admin secret via header or query', async () => {
  const headerRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { 'x-admin-secret': 'test_secret_key_456' }
  });
  assert.equal(headerRes.status, 200);
  const data = await headerRes.json();
  assert.ok('onlinePlayers' in data);
  assert.ok('rooms' in data);
  assert.equal(data.dbMode, 'sqlite');

  const queryRes = await fetch(`${baseUrl}/api/admin/overview?secret=test_secret_key_456`);
  assert.equal(queryRes.status, 200);
});

test('Admin moderation: mute, unmute, ban, and unban lifecycle', async () => {
  // Create user
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'troublemaker1', password: 'password123' })
  });
  assert.equal(signupRes.status, 200);
  const userData = await signupRes.json();
  const userId = userData.playerId;

  // 1. Check initial status
  let status = await db.getUserModerationStatus(userId);
  assert.equal(status.isBanned, false);
  assert.equal(status.isMuted, false);

  // 2. Mute player for 30 minutes
  const muteRes = await fetch(`${baseUrl}/api/admin/users/${userId}/mute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': 'test_secret_key_456'
    },
    body: JSON.stringify({ muted: true, durationMinutes: 30 })
  });
  assert.equal(muteRes.status, 200);
  status = await db.getUserModerationStatus(userId);
  assert.equal(status.isMuted, true);
  assert.ok(status.mutedUntil);

  // 3. Unmute player
  const unmuteRes = await fetch(`${baseUrl}/api/admin/users/${userId}/mute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': 'test_secret_key_456'
    },
    body: JSON.stringify({ muted: false })
  });
  assert.equal(unmuteRes.status, 200);
  status = await db.getUserModerationStatus(userId);
  assert.equal(status.isMuted, false);

  // 4. Ban player
  const banRes = await fetch(`${baseUrl}/api/admin/users/${userId}/ban`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': 'test_secret_key_456'
    },
    body: JSON.stringify({ banned: true, reason: 'Griefing plaza' })
  });
  assert.equal(banRes.status, 200);
  status = await db.getUserModerationStatus(userId);
  assert.equal(status.isBanned, true);
  assert.equal(status.banReason, 'Griefing plaza');

  // 5. Banned player login is rejected
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'troublemaker1', password: 'password123' })
  });
  assert.equal(loginRes.status, 401);
  const loginData = await loginRes.json();
  assert.match(loginData.error, /suspended/i);

  // 6. Unban player
  const unbanRes = await fetch(`${baseUrl}/api/admin/users/${userId}/ban`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': 'test_secret_key_456'
    },
    body: JSON.stringify({ banned: false })
  });
  assert.equal(unbanRes.status, 200);
  status = await db.getUserModerationStatus(userId);
  assert.equal(status.isBanned, false);

  // Login succeeds again
  const loginAgainRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'troublemaker1', password: 'password123' })
  });
  assert.equal(loginAgainRes.status, 200);
});

test('Player reports submission and resolution lifecycle', async () => {
  // Submit report via /api/report
  const reportRes = await fetch(`${baseUrl}/api/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reporterId: 'usr_reporter_1',
      reportedId: 'usr_offender_2',
      reason: 'Spamming advertisement bots in loft',
      roomId: 'plaza'
    })
  });
  assert.equal(reportRes.status, 200);
  const reportData = await reportRes.json();
  assert.equal(reportData.success, true);
  const reportId = reportData.report.id;

  // List reports via admin endpoint
  const listRes = await fetch(`${baseUrl}/api/admin/reports?status=open`, {
    headers: { 'x-admin-secret': 'test_secret_key_456' }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.reports.some(r => r.id === reportId));

  // Resolve report
  const resolveRes = await fetch(`${baseUrl}/api/admin/reports/${reportId}/resolve`, {
    method: 'POST',
    headers: { 'x-admin-secret': 'test_secret_key_456' }
  });
  assert.equal(resolveRes.status, 200);
  const resolveData = await resolveRes.json();
  assert.equal(resolveData.status, 'resolved');

  // Verify it is resolved in DB
  const reportsAfter = await db.listPlayerReports('open');
  assert.ok(!reportsAfter.some(r => r.id === reportId));
});

test('Batch invite code generation via admin API', async () => {
  const genRes = await fetch(`${baseUrl}/api/admin/invites/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': 'test_secret_key_456'
    },
    body: JSON.stringify({ count: 3, maxUses: 5, expiresDays: 14 })
  });
  assert.equal(genRes.status, 200);
  const genData = await genRes.json();
  assert.equal(genData.success, true);
  assert.equal(genData.invites.length, 3);
  assert.equal(genData.invites[0].max_uses, 5);

  const listRes = await fetch(`${baseUrl}/api/admin/invites`, {
    headers: { 'x-admin-secret': 'test_secret_key_456' }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.invites.length >= 3);
});

test('Closed Alpha signup gating enforces invite codes when ALPHA_INVITE_ONLY=1', async () => {
  process.env.ALPHA_INVITE_ONLY = '1';

  // 1. Attempt signup without invite code -> rejected
  const noCodeRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alphatester1', password: 'password123' })
  });
  assert.equal(noCodeRes.status, 400);
  const noCodeData = await noCodeRes.json();
  assert.match(noCodeData.error, /invite code is required/i);

  // 2. Attempt signup with invalid invite code -> rejected
  const invalidCodeRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alphatester1', password: 'password123', inviteCode: 'FAKE-CODE-999' })
  });
  assert.equal(invalidCodeRes.status, 400);
  const invalidCodeData = await invalidCodeRes.json();
  assert.match(invalidCodeData.error, /invalid/i);

  // 3. Create a valid invite code
  const codeRecord = await db.createInviteCode({ maxUses: 1 });

  // 4. Signup with valid code -> succeeds
  const validRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alphatester1', password: 'password123', inviteCode: codeRecord.code })
  });
  assert.equal(validRes.status, 200);
  const validData = await validRes.json();
  assert.equal(validData.success, true);
  assert.equal(validData.name, 'alphatester1');

  // 5. Attempt reusing same single-use code -> rejected
  const reuseRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alphatester2', password: 'password123', inviteCode: codeRecord.code })
  });
  assert.equal(reuseRes.status, 400);

  // Reset flag
  delete process.env.ALPHA_INVITE_ONLY;
});
