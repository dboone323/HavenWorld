import { redis } from '../redis';

/**
 * Distributed lock entry returned by acquire().
 */
export interface DistributedLock {
  resource: string;
  token: string;
  expiresAt: number;
}

/**
 * Options for lock acquisition.
 */
export interface LockOptions {
  /** How long to hold the lock (ms). Default: 10_000 */
  ttlMs?: number;
  /** How many times to retry before giving up. Default: 3 */
  retries?: number;
  /** Delay between retries (ms). Default: 200 */
  retryDelayMs?: number;
}

/**
 * DistributedLockManager — a Redlock-style single-node Redis lock.
 *
 * Design:
 *  - Acquire: SET resource token PX ttlMs NX
 *  - Release: Lua script — DEL only if token matches (prevents alien release)
 *  - Extend: Lua script — PEXPIRE only if token matches
 *  - Check: TTL inspection — is the lock still held by our token?
 *
 * Suitable for coordinating across server cluster replicas where all
 * nodes share a single Redis sentinel/cluster. For multi-Redis Redlock,
 * replace the single SET with quorum writes across N Redis instances.
 */
export class DistributedLockManager {
  private static readonly LOCK_PREFIX = 'dlock:';

  /**
   * Generates a unique lock token — combines process PID, timestamp, and random.
   */
  static generateToken(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Acquires a distributed lock on `resource`.
   * Retries up to `options.retries` times with `options.retryDelayMs` delay.
   * Throws 'LOCK_ACQUISITION_FAILED' if unable to acquire within retry budget.
   */
  static async acquire(resource: string, options: LockOptions = {}): Promise<DistributedLock> {
    const ttlMs = options.ttlMs ?? 10_000;
    const retries = options.retries ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 200;

    const key = `${DistributedLockManager.LOCK_PREFIX}${resource}`;
    const token = DistributedLockManager.generateToken();

    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await redis.set(key, token, { PX: ttlMs, NX: true });
      if (result === 'OK') {
        return { resource, token, expiresAt: Date.now() + ttlMs };
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error('LOCK_ACQUISITION_FAILED');
  }

  /**
   * Releases the lock — only if the token still matches (prevents alien release).
   * Returns true if the lock was released, false if it had already expired/been taken.
   */
  static async release(lock: DistributedLock): Promise<boolean> {
    const key = `${DistributedLockManager.LOCK_PREFIX}${lock.resource}`;

    // Lua script: DEL only if our token matches
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    const released = await redis.eval(script, { keys: [key], arguments: [lock.token] });
    return released === 1;
  }

  /**
   * Extends the lock TTL by `extendByMs` — only if token still matches.
   * Returns true if successfully extended.
   */
  static async extend(lock: DistributedLock, extendByMs: number): Promise<boolean> {
    const key = `${DistributedLockManager.LOCK_PREFIX}${lock.resource}`;

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    const ok = await redis.eval(script, {
      keys: [key],
      arguments: [lock.token, String(extendByMs)],
    });
    return ok === 1;
  }

  /**
   * Returns true if the lock for `resource` is currently held by `token`.
   */
  static async isHeld(resource: string, token: string): Promise<boolean> {
    const key = `${DistributedLockManager.LOCK_PREFIX}${resource}`;
    const val = await redis.get(key);
    return val === token;
  }

  /**
   * Returns the remaining TTL (ms) for a lock, or 0 if expired/not held.
   */
  static async getRemainingTtlMs(resource: string): Promise<number> {
    const key = `${DistributedLockManager.LOCK_PREFIX}${resource}`;
    const pttl = await redis.pTTL(key);
    return Math.max(0, pttl);
  }

  /**
   * Acquires a lock, executes `fn`, then unconditionally releases the lock.
   * Useful for wrapping critical sections.
   */
  static async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T> {
    const lock = await DistributedLockManager.acquire(resource, options);
    try {
      return await fn();
    } finally {
      await DistributedLockManager.release(lock);
    }
  }
}
