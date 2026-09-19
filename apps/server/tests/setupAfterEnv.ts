import { redis, connectRedis } from '../src/redis';

beforeAll(async () => {
  if (!redis.isOpen) {
    try {
      await connectRedis();
    } catch (err) {
      console.warn('[setupAfterEnv] Could not connect to Redis:', err);
    }
  }
});

afterAll(async () => {
  if (redis.isOpen) {
    try {
      await redis.quit();
    } catch (err) {
      console.warn('[setupAfterEnv] Error quitting Redis:', err);
    }
  }
});
