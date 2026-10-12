import { SERVER_CONFIG } from '../../index';
import { prisma } from '../../prisma';
import { redis } from '../../redis';

describe('Batch 10: Infrastructure, CI Workflows & Milestone Verification', () => {
  it('exposes valid server environment configuration', () => {
    expect(SERVER_CONFIG).toBeDefined();
    expect(typeof SERVER_CONFIG.port).toBe('number');
    expect(SERVER_CONFIG.version).toBe('0.1.0');
    expect(SERVER_CONFIG.nodeEnv).toBeDefined();
  });

  it('verifies primary database and cache connectivity for CI health gate', async () => {
    const rawResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT 1 AS count;
    `;
    expect(rawResult).toBeDefined();
    expect(rawResult.length).toBe(1);

    if (!redis.isOpen) {
      const { connectRedis } = await import('../../redis');
      await connectRedis();
    }
    expect(redis.isOpen).toBe(true);
  });
});
