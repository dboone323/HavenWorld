import { redis } from '../redis';
import { roomManager } from './RoomManager';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export type AfkPresenceStage = 'ACTIVE' | 'IDLE' | 'DROWSY' | 'SLEEPING' | 'AUTO_DEPART_SCHEDULED';

export interface AfkPlayerStatus {
  userId: string;
  stage: AfkPresenceStage;
  elapsedMs: number;
  lastActiveAt: number;
  isEvictable: boolean;
}

export class AfkDetectionService {
  // Thresholds in milliseconds
  public static readonly IDLE_THRESHOLD_MS = 3 * 60_000;       // 3 minutes
  public static readonly DROWSY_THRESHOLD_MS = 6 * 60_000;     // 6 minutes
  public static readonly SLEEPING_THRESHOLD_MS = 10 * 60_000;  // 10 minutes
  public static readonly EVICTION_THRESHOLD_MS = 15 * 60_000;  // 15 minutes

  /**
   * Records user activity heartbeat in Redis
   */
  static async recordActivity(userId: string, roomId?: string): Promise<number> {
    const now = Date.now();
    await redis.set(`player:last_activity:${userId}`, String(now));
    if (roomId) {
      await redis.set(`player:room:${userId}`, roomId);
    }
    return now;
  }

  /**
   * Calculates player inactivity duration and maps to progressive presence stage
   */
  static async getPlayerStatus(userId: string, now: number = Date.now()): Promise<AfkPlayerStatus> {
    const raw = await redis.get(`player:last_activity:${userId}`);
    const lastActiveAt = raw ? parseInt(raw, 10) : now;
    const elapsedMs = Math.max(0, now - lastActiveAt);

    let stage: AfkPresenceStage = 'ACTIVE';
    if (elapsedMs >= this.EVICTION_THRESHOLD_MS) {
      stage = 'AUTO_DEPART_SCHEDULED';
    } else if (elapsedMs >= this.SLEEPING_THRESHOLD_MS) {
      stage = 'SLEEPING';
    } else if (elapsedMs >= this.DROWSY_THRESHOLD_MS) {
      stage = 'DROWSY';
    } else if (elapsedMs >= this.IDLE_THRESHOLD_MS) {
      stage = 'IDLE';
    }

    return {
      userId,
      stage,
      elapsedMs,
      lastActiveAt,
      isEvictable: elapsedMs >= this.EVICTION_THRESHOLD_MS,
    };
  }

  /**
   * Evaluates inactivity across players in a room
   */
  static async evaluateRoom(roomId: string, now: number = Date.now()): Promise<{
    roomId: string;
    totalPlayers: number;
    activeCount: number;
    sleepingCount: number;
    evictableUsers: string[];
  }> {
    const players = roomManager.getRoomPlayers(roomId);
    let activeCount = 0;
    let sleepingCount = 0;
    const evictableUsers: string[] = [];

    for (const p of players) {
      const status = await this.getPlayerStatus(p.id, now);
      if (status.stage === 'ACTIVE') {
        activeCount++;
      } else if (status.stage === 'SLEEPING' || status.stage === 'AUTO_DEPART_SCHEDULED') {
        sleepingCount++;
      }

      if (status.isEvictable) {
        evictableUsers.push(p.id);
      }
    }

    return {
      roomId,
      totalPlayers: players.length,
      activeCount,
      sleepingCount,
      evictableUsers,
    };
  }

  /**
   * Automatically departs players who exceeded the max inactivity threshold
   */
  static async evictInactivePlayers(roomId: string, now: number = Date.now()): Promise<string[]> {
    const { evictableUsers } = await this.evaluateRoom(roomId, now);
    const io = getIO();

    for (const userId of evictableUsers) {
      roomManager.leaveRoomByUserId(userId);
      if (io) {
        io.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, { playerId: userId });
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.SERVER_ALERT, {
          title: 'Departed due to inactivity',
          message: 'You took a restful nap and were returned to the lobby.',
          icon: '💤',
        });
      }
    }

    return evictableUsers;
  }
}
