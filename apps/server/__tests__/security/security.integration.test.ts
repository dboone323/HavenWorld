import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser } from '../helpers/factories';
import { truncateAllTables } from '../helpers/dbHelpers';
import { EconomySecurity, MAX_WEEKLY_EARNINGS_CAP } from '../../src/game/economy';
import { ChatMessageSchema, RegisterSchema } from '../../src/validation/schemas';
import { generateCsrfToken } from '../../src/middleware/csrf';

describe('Part 8: Security Audit & Hardening Integration Tests', () => {
  beforeAll(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('1. CSRF Double-Submit Protection', () => {
    it('should reject state-changing request if csrf_token cookie is present without header', async () => {
      const token = generateCsrfToken();
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`csrf_token=${token}`])
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
    });

    it('should reject state-changing request if csrf_token header does not match cookie', async () => {
      const cookieToken = generateCsrfToken();
      const mismatchedToken = generateCsrfToken();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`csrf_token=${cookieToken}`])
        .set('X-CSRF-Token', mismatchedToken)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_INVALID');
    });
  });

  describe('2. JWT Algorithm Pinning', () => {
    it('should reject tokens with alg: "none" or untrusted algorithms', async () => {
      // Create forged token with algorithm: none
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          userId: 'fake-admin-id',
          username: 'hacker',
          role: 'ADMIN',
        })
      ).toString('base64url');
      const forgedNoneToken = `${header}.${payload}.`;

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${forgedNoneToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    it('should accept properly signed HS256 tokens', async () => {
      const user = await createTestUser({ username: 'jwt_valid_user' });
      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET!;
      const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        secret,
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
    });
  });

  describe('3. XSS Input Sanitization', () => {
    it('should sanitize script tags in chat messages', () => {
      const dangerousInput = {
        roomId: 'room-1',
        message: 'Hello <script>alert("pwned")</script> World!',
      };

      const parsed = ChatMessageSchema.safeParse(dangerousInput);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.message).not.toContain('<script>');
        expect(parsed.data.message).toBe('Hello alert("pwned") World!');
      }
    });

    it('should sanitize malicious script tags in username during registration validation', () => {
      const dangerousRegistration = {
        username: '<script>evil()</script>',
        email: 'attacker@evil.com',
        password: 'Password123!',
      };

      const parsed = RegisterSchema.safeParse(dangerousRegistration);
      // Either rejects due to regex or sanitizes away tags
      if (parsed.success) {
        expect(parsed.data.username).not.toContain('<script>');
      } else {
        expect(parsed.success).toBe(false);
      }
    });
  });

  describe('4. Admin Privilege Fresh DB Verification', () => {
    it('should reject access to admin endpoints if DB user role is not ADMIN even if JWT claims ADMIN', async () => {
      // User is PLAYER in DB
      const user = await createTestUser({ username: 'sneaky_player', isAdmin: false });

      // Attacker somehow has a token claiming role: ADMIN
      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET!;
      const forgedAdminJwt = jwt.sign(
        { userId: user.id, username: user.username, role: 'ADMIN' },
        secret,
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const res = await request(app)
        .post('/api/admin/users/fake-id/ban')
        .set('Authorization', `Bearer ${forgedAdminJwt}`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('should allow access to admin endpoints if DB user role is actually ADMIN', async () => {
      const admin = await createTestUser({ username: 'real_admin_user', isAdmin: true });
      const target = await createTestUser({ username: 'target_ban_user', isAdmin: false });

      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET!;
      const adminJwt = jwt.sign(
        { userId: admin.id, username: admin.username, role: 'ADMIN' },
        secret,
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const res = await request(app)
        .post(`/api/admin/users/${target.id}/ban`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({});

      expect(res.status).toBe(200);

      const updatedTarget = await prisma.user.findUnique({ where: { id: target.id } });
      expect(updatedTarget?.isBanned).toBe(true);

      // Verify AdminAuditLog was created
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: { adminId: admin.id, action: 'BAN_USER' },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.targetId).toBe(target.id);
    });
  });

  describe('5. Economy Exploit Prevention & Atomic Integrity', () => {
    it('should reject negative and zero coin transfers', async () => {
      const userA = await createTestUser({ havenCoins: 500 });
      const userB = await createTestUser({ havenCoins: 100 });

      await expect(
        EconomySecurity.transferCoins(userA.id, userB.id, -50)
      ).rejects.toThrow(/INVALID_AMOUNT/);

      await expect(
        EconomySecurity.transferCoins(userA.id, userB.id, 0)
      ).rejects.toThrow(/INVALID_AMOUNT/);

      await expect(
        EconomySecurity.transferCoins(userA.id, userB.id, 10.5)
      ).rejects.toThrow(/INVALID_AMOUNT/);
    });

    it('should reject self-transfers', async () => {
      const userA = await createTestUser({ havenCoins: 500 });
      await expect(
        EconomySecurity.transferCoins(userA.id, userA.id, 50)
      ).rejects.toThrow(/INVALID_TRANSFER/);
    });

    it('should reject transfers exceeding sender balance', async () => {
      const userA = await createTestUser({ havenCoins: 50 });
      const userB = await createTestUser({ havenCoins: 100 });

      await expect(
        EconomySecurity.transferCoins(userA.id, userB.id, 100)
      ).rejects.toThrow(/INSUFFICIENT_FUNDS/);
    });

    it('should atomically transfer coins and create a transaction audit log', async () => {
      const userA = await createTestUser({ havenCoins: 300 });
      const userB = await createTestUser({ havenCoins: 100 });

      const result = await EconomySecurity.transferCoins(userA.id, userB.id, 50, 'TEST_PAYMENT');
      expect(result.success).toBe(true);
      expect(result.senderBalance).toBe(250);
      expect(result.receiverBalance).toBe(150);

      const txLog = await prisma.transactionLog.findUnique({
        where: { id: result.transactionId },
      });
      expect(txLog).not.toBeNull();
      expect(txLog?.amount).toBe(50);
      expect(txLog?.senderId).toBe(userA.id);
      expect(txLog?.receiverId).toBe(userB.id);
    });

    it('should enforce the weekly earnings cap of 500 coins', async () => {
      const user = await createTestUser({ havenCoins: 100 });

      // First reward of 400 coins succeeds
      const r1 = await EconomySecurity.awardReward(user.id, 400, 'DAILY_QUEST');
      expect(r1.weeklyEarnings).toBe(400);

      // Second reward of 150 coins exceeds 500 cap (400 + 150 = 550) and should be rejected
      await expect(
        EconomySecurity.awardReward(user.id, 150, 'EXTRA_REWARD')
      ).rejects.toThrow(/WEEKLY_CAP_EXCEEDED/);

      // Verify balance was not incremented
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(dbUser?.havenCoins).toBe(500); // 100 initial + 400 reward
      expect(dbUser?.weeklyEarnings).toBe(400);
    });
  });
});
