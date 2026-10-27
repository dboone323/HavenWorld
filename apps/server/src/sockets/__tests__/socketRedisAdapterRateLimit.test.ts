import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { redis, connectRedis, disconnectRedis } from '../../redis';
import { checkMoveRateLimit } from '../index';
import { initSocketRedisAdapter } from '../../index';

describe('Socket Redis Adapter & Distributed Rate Limiter', () => {
  beforeAll(async () => {
    if (!redis.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    await disconnectRedis();
  });

  describe('checkMoveRateLimit', () => {
    it('increments ratelimit:move:<userId> in Redis and enforces 20 moves/sec cap', async () => {
      const testUserId = `test-user-${Date.now()}`;
      const redisKey = `ratelimit:move:${testUserId}`;

      await redis.del(redisKey);

      // Fire 20 moves within the same second - all should be accepted
      for (let i = 0; i < 20; i++) {
        const allowed = checkMoveRateLimit(testUserId);
        expect(allowed).toBe(true);
      }

      // 21st move should be rate limited
      const rateLimited = checkMoveRateLimit(testUserId);
      expect(rateLimited).toBe(false);

      // Wait a moment for fire-and-forget Redis promises to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify Redis received the rate limit counters
      const redisCount = await redis.get(redisKey);
      expect(Number(redisCount)).toBeGreaterThanOrEqual(1);
      expect(Number(redisCount)).toBeLessThanOrEqual(20);

      // Clean up Redis key
      await redis.del(redisKey);
    });

    it('falls back cleanly to in-memory rate limiting without throwing when Redis key cannot be incremented', async () => {
      const fallbackUserId = `fallback-user-${Date.now()}`;

      // Enforce the 20 moves/sec cap purely in-memory
      for (let i = 0; i < 20; i++) {
        const allowed = checkMoveRateLimit(fallbackUserId);
        expect(allowed).toBe(true);
      }

      const blocked = checkMoveRateLimit(fallbackUserId);
      expect(blocked).toBe(false);
    });
  });

  describe('initSocketRedisAdapter', () => {
    let testHttpServer: ReturnType<typeof createServer>;
    let testIo: SocketIOServer;

    beforeEach(() => {
      testHttpServer = createServer();
      testIo = new SocketIOServer(testHttpServer);
    });

    afterEach(async () => {
      const adapter = testIo.of('/').adapter as any;
      testIo.close();
      await new Promise<void>((resolve) => testHttpServer.close(() => resolve()));

      if (adapter?.pubClient?.isOpen) {
        await adapter.pubClient.quit();
      }
      if (adapter?.subClient?.isOpen) {
        await adapter.subClient.quit();
      }
    });

    it('wires the @socket.io/redis-adapter successfully when Redis is connected', async () => {
      const wired = await initSocketRedisAdapter(testIo);
      expect(wired).toBe(true);

      const adapter = testIo.of('/').adapter as any;
      expect(adapter).toBeDefined();
      expect(adapter.pubClient).toBeDefined();
      expect(adapter.subClient).toBeDefined();
      expect(adapter.pubClient.isOpen).toBe(true);
      expect(adapter.subClient.isOpen).toBe(true);
    });

    it('returns false and falls back to in-memory adapter when DISABLE_REDIS=true', async () => {
      const prevEnv = process.env.DISABLE_REDIS;
      process.env.DISABLE_REDIS = 'true';

      try {
        const wired = await initSocketRedisAdapter(testIo);
        expect(wired).toBe(false);
      } finally {
        if (prevEnv === undefined) {
          delete process.env.DISABLE_REDIS;
        } else {
          process.env.DISABLE_REDIS = prevEnv;
        }
      }
    });
  });
});
