import { DistributedLockManager } from '../DistributedLockManager';
import { redis, connectRedis, disconnectRedis } from '../../redis';

const RESOURCE = `test-lock-b50-${Date.now()}`;

describe('Batch 50: Server Cluster Distributed Lock Manager (Redlock)', () => {
  beforeAll(async () => {
    await connectRedis();
  });

  afterAll(async () => {
    // Clean up any lingering test keys
    await redis.del(`dlock:${RESOURCE}`);
    await disconnectRedis();
  });

  it('acquire returns a lock with token and future expiresAt', async () => {
    const lock = await DistributedLockManager.acquire(RESOURCE, { ttlMs: 5000 });

    expect(lock.resource).toBe(RESOURCE);
    expect(lock.token).toBeTruthy();
    expect(lock.expiresAt).toBeGreaterThan(Date.now());

    await DistributedLockManager.release(lock);
  });

  it('release returns true and the lock is no longer held', async () => {
    const lock = await DistributedLockManager.acquire(RESOURCE, { ttlMs: 5000 });
    const held = await DistributedLockManager.isHeld(RESOURCE, lock.token);
    expect(held).toBe(true);

    const released = await DistributedLockManager.release(lock);
    expect(released).toBe(true);

    const heldAfter = await DistributedLockManager.isHeld(RESOURCE, lock.token);
    expect(heldAfter).toBe(false);
  });

  it('second acquire fails (LOCK_ACQUISITION_FAILED) while first lock is held', async () => {
    const lock = await DistributedLockManager.acquire(RESOURCE, { ttlMs: 5000 });

    await expect(
      DistributedLockManager.acquire(RESOURCE, { retries: 0 }),
    ).rejects.toThrow('LOCK_ACQUISITION_FAILED');

    await DistributedLockManager.release(lock);
  });

  it('extend renews TTL for an active lock', async () => {
    const lock = await DistributedLockManager.acquire(RESOURCE, { ttlMs: 2000 });

    const extended = await DistributedLockManager.extend(lock, 10_000);
    expect(extended).toBe(true);

    const ttlMs = await DistributedLockManager.getRemainingTtlMs(RESOURCE);
    expect(ttlMs).toBeGreaterThan(2000); // extended beyond original 2 s

    await DistributedLockManager.release(lock);
  });

  it('withLock acquires, executes fn, then auto-releases', async () => {
    let executed = false;

    const result = await DistributedLockManager.withLock(
      RESOURCE,
      async () => {
        executed = true;
        const held = await DistributedLockManager.getRemainingTtlMs(RESOURCE);
        expect(held).toBeGreaterThan(0);
        return 'done';
      },
      { ttlMs: 5000 },
    );

    expect(executed).toBe(true);
    expect(result).toBe('done');

    // After fn completes, lock should be gone
    const ttlMs = await DistributedLockManager.getRemainingTtlMs(RESOURCE);
    expect(ttlMs).toBe(0);
  });
});
