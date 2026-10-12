import { RedisHealthService } from '../RedisHealthService';
import { redis, connectRedis } from '../../redis';

describe('Batch 4: RedisHealthService & Session Pruning', () => {
  beforeAll(async () => {
    if (!redis.isOpen) {
      await connectRedis();
    }
  });

  it('produces a valid health report reflecting live Redis connection', async () => {
    const report = await RedisHealthService.getHealthReport();
    expect(report.isReady).toBe(true);
    expect(report.status).toBe('connected');
    expect(typeof report.usedMemoryBytes).toBe('number');
    expect(report.usedMemoryBytes).toBeGreaterThan(0);
  });

  it('prunes stale users from roster set while preserving active users', async () => {
    const rosterKey = 'test_online_users';
    await redis.del(rosterKey);
    await redis.sAdd(rosterKey, ['user_active_1', 'user_active_2', 'user_zombie_3']);

    const prunedCount = await RedisHealthService.pruneStaleOnlineSessions(
      ['user_active_1', 'user_active_2'],
      rosterKey
    );
    expect(prunedCount).toBe(1);

    const remaining = await redis.sMembers(rosterKey);
    expect(remaining).toContain('user_active_1');
    expect(remaining).toContain('user_active_2');
    expect(remaining).not.toContain('user_zombie_3');

    // Clean up
    await redis.del(rosterKey);
  });
});
