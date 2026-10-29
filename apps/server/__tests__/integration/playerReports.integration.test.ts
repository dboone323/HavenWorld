import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser } from '../helpers/factories';
import { truncateAllTables } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';

describe('Player Reports Flow (A1 Implementation)', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('rejects report submission without authentication with 401 or 403', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({
        reportedUserId: '00000000-0000-0000-0000-000000000001',
        reason: 'HARASSMENT',
      });

    expect([401, 403]).toContain(res.status);

    const resBadToken = await request(app)
      .post('/api/reports')
      .set('Authorization', 'Bearer invalid-token')
      .send({
        reportedUserId: '00000000-0000-0000-0000-000000000001',
        reason: 'HARASSMENT',
      });

    expect(resBadToken.status).toBe(401);
  });

  it('rejects reporting oneself with 400', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id, '15m', { role: user.role });

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reportedUserId: user.id,
        reason: 'HARASSMENT',
        description: 'Trying to report self',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot report yourself/i);
  });

  it('rejects invalid reason with 400', async () => {
    const reporter = await createTestUser();
    const target = await createTestUser();
    const token = generateTestToken(reporter.id, '15m', { role: reporter.role });

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reportedUserId: target.id,
        reason: 'INVALID_REASON',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid report data/i);
  });

  it('rejects non-existent reported user with 404', async () => {
    const reporter = await createTestUser();
    const token = generateTestToken(reporter.id, '15m', { role: reporter.role });
    const nonExistentId = randomUUID();

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reportedUserId: nonExistentId,
        reason: 'HARASSMENT',
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/does not exist/i);
  });

  it('creates a report in database with OPEN status and timestamp', async () => {
    const reporter = await createTestUser();
    const target = await createTestUser();
    const token = generateTestToken(reporter.id, '15m', { role: reporter.role });

    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reportedUserId: target.id,
        reason: 'INAPPROPRIATE_CONTENT',
        description: 'Used offensive slurs in chat',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('reportId');

    const reportInDb = await prisma.report.findUnique({
      where: { id: res.body.reportId },
    });

    expect(reportInDb).not.toBeNull();
    expect(reportInDb?.reporterId).toBe(reporter.id);
    expect(reportInDb?.reportedUserId).toBe(target.id);
    expect(reportInDb?.reason).toBe('INAPPROPRIATE_CONTENT');
    expect(reportInDb?.description).toBe('Used offensive slurs in chat');
    expect(reportInDb?.status).toBe('OPEN');
    expect(new Date(reportInDb!.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('enforces admin-only access on GET /api/admin/reports/open', async () => {
    const regularUser = await createTestUser({ role: 'PLAYER' });
    const adminUser = await createTestUser({ role: 'ADMIN' });
    const target = await createTestUser();
    const playerToken = generateTestToken(regularUser.id, '15m', { role: regularUser.role });
    const adminToken = generateTestToken(adminUser.id, '15m', { role: adminUser.role });

    // Create a report first
    await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        reportedUserId: target.id,
        reason: 'CHEATING',
        description: 'Speed hacking',
      });

    // 1. Regular user gets 403 Forbidden
    const forbiddenRes = await request(app)
      .get('/api/admin/reports/open')
      .set('Authorization', `Bearer ${playerToken}`);

    expect(forbiddenRes.status).toBe(403);

    // 2. Admin gets 200 with open reports list
    const adminRes = await request(app)
      .get('/api/admin/reports/open')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminRes.status).toBe(200);
    expect(Array.isArray(adminRes.body.reports)).toBe(true);
    expect(adminRes.body.reports.length).toBeGreaterThanOrEqual(1);
    expect(adminRes.body.reports[0].status).toBe('OPEN');
    expect(adminRes.body.reports[0].reportedUser.id).toBe(target.id);
  });
});
