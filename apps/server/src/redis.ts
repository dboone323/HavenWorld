import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = createClient({ url: redisUrl });
export const redisClient = redis;

redis.on('error', (err) => console.error('[Redis] Client error:', err));
redis.on('connect', () => console.log('[Redis] Connected successfully'));
redis.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));

export const connectRedis = async (): Promise<void> => {
  await redis.connect();
  console.log('[Redis] Ready');
};
