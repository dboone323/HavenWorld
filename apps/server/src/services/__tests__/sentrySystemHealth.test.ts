import request from 'supertest';
import { app } from '../../index';
import { traceSpan } from '../../monitoring/sentry';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { generateTestToken } from '../../../__tests__/helpers/jwtHelpers';
import { prisma } from '../../prisma';

describe('Batch 20: Sentry APM Spans and System Health Endpoint', () => {
  it('traceSpan executes monitored functions and propagates results and errors cleanly', async () => {
    const result = await traceSpan('test.span', 'unit_test', async () => {
      return 42 * 2;
    }, { testTag: 'apm' });

    expect(result).toBe(84);

    await expect(
      traceSpan('test.failure_span', 'unit_test', async () => {
        throw new Error('APM_SPAN_ERROR');
      })
    ).rejects.toThrow('APM_SPAN_ERROR');
  });

  it('GET /api/admin/system-health enforces admin RBAC and returns comprehensive diagnostic metrics', async () => {
    const adminUser = await createTestUser({ role: 'ADMIN', isAdmin: true });
    const playerUser = await createTestUser({ role: 'PLAYER', isAdmin: false });

    const adminToken = generateTestToken(adminUser.id, '15m', { role: 'ADMIN' });
    const playerToken = generateTestToken(playerUser.id, '15m', { role: 'PLAYER' });

    // 1. Regular player must be rejected with 403 Forbidden
    const playerRes = await request(app)
      .get('/api/admin/system-health')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(playerRes.status).toBe(403);

    // 2. Admin receives full system diagnostic report
    const res = await request(app)
      .get('/api/admin/system-health')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(['HEALTHY', 'DEGRADED']).toContain(res.body.status);
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.database).toBeDefined();
    expect(res.body.database.status).toBe('ok');
    expect(typeof res.body.database.latencyMs).toBe('number');
    expect(res.body.redis).toBeDefined();
    expect(res.body.process).toBeDefined();
    expect(typeof res.body.process.nodeVersion).toBe('string');
    expect(res.body.process.memoryUsageMb).toBeDefined();
    expect(typeof res.body.process.memoryUsageMb.heapUsed).toBe('number');

    // Cleanup
    await prisma.avatar.deleteMany({ where: { userId: { in: [adminUser.id, playerUser.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, playerUser.id] } } });
  });
});
