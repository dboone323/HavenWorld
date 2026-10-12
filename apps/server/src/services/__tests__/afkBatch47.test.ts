import { AfkDetectionService } from '../AfkDetectionService';
import { roomManager } from '../RoomManager';
import { redis, connectRedis, disconnectRedis } from '../../redis';

describe('Batch 47: Automated Player AFK Detection, Drowsy/Sleep States, and Room Auto-Depart', () => {
  const testUserId = `user_afk_${Date.now()}`;
  const testRoomId = `room_afk_${Date.now()}`;

  beforeAll(async () => {
    await connectRedis();
  });

  afterAll(async () => {
    await redis.del(`player:last_activity:${testUserId}`);
    await redis.del(`player:room:${testUserId}`);
    roomManager.leaveRoom(testUserId);
    await disconnectRedis();
  });

  it('records user activity and reports ACTIVE state immediately', async () => {
    const timestamp = await AfkDetectionService.recordActivity(testUserId, testRoomId);
    expect(timestamp).toBeGreaterThan(0);

    const status = await AfkDetectionService.getPlayerStatus(testUserId, timestamp + 1000);
    expect(status.stage).toBe('ACTIVE');
    expect(status.isEvictable).toBe(false);
  });

  it('progresses to IDLE, DROWSY, and SLEEPING based on elapsed inactivity', async () => {
    const now = Date.now();
    await redis.set(`player:last_activity:${testUserId}`, String(now));

    // After 4 minutes -> IDLE
    const idleStatus = await AfkDetectionService.getPlayerStatus(testUserId, now + 4 * 60_000);
    expect(idleStatus.stage).toBe('IDLE');

    // After 7 minutes -> DROWSY
    const drowsyStatus = await AfkDetectionService.getPlayerStatus(testUserId, now + 7 * 60_000);
    expect(drowsyStatus.stage).toBe('DROWSY');

    // After 11 minutes -> SLEEPING
    const sleepingStatus = await AfkDetectionService.getPlayerStatus(testUserId, now + 11 * 60_000);
    expect(sleepingStatus.stage).toBe('SLEEPING');

    // After 16 minutes -> AUTO_DEPART_SCHEDULED & isEvictable
    const evictStatus = await AfkDetectionService.getPlayerStatus(testUserId, now + 16 * 60_000);
    expect(evictStatus.stage).toBe('AUTO_DEPART_SCHEDULED');
    expect(evictStatus.isEvictable).toBe(true);
  });

  it('evaluates room inactivity and executes auto-depart eviction for expired players', async () => {
    // Add user to RoomManager
    roomManager.joinRoom(testRoomId, `socket_${testUserId}`, {
      id: testUserId,
      username: 'SleepyDozingPlayer',
      roomId: testRoomId,
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: {},
    });

    const now = Date.now();
    // Simulate 20 minutes ago
    await redis.set(`player:last_activity:${testUserId}`, String(now - 20 * 60_000));

    const evalResult = await AfkDetectionService.evaluateRoom(testRoomId, now);
    expect(evalResult.evictableUsers).toContain(testUserId);

    const evicted = await AfkDetectionService.evictInactivePlayers(testRoomId, now);
    expect(evicted).toContain(testUserId);

    // Player should no longer be in the room
    const remaining = roomManager.getRoomPlayers(testRoomId);
    expect(remaining.some((p: any) => p.id === testUserId)).toBe(false);
  });
});
