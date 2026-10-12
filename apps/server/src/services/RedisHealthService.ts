import { redis } from '../redis';

export interface RedisHealthReport {
  isReady: boolean;
  status: 'connected' | 'disconnected';
  usedMemoryBytes?: number;
  connectedClients?: number;
}

export class RedisHealthService {
  /**
   * Evaluates Redis connection readiness and returns parsed health telemetry.
   */
  static async getHealthReport(): Promise<RedisHealthReport> {
    const isReady = redis.isReady;
    if (!isReady) {
      return {
        isReady: false,
        status: 'disconnected',
      };
    }

    try {
      const info = await redis.info('memory');
      const clientsInfo = await redis.info('clients');

      let usedMemoryBytes: number | undefined;
      const memMatch = info.match(/used_memory:(\d+)/);
      if (memMatch) {
        usedMemoryBytes = parseInt(memMatch[1], 10);
      }

      let connectedClients: number | undefined;
      const clientMatch = clientsInfo.match(/connected_clients:(\d+)/);
      if (clientMatch) {
        connectedClients = parseInt(clientMatch[1], 10);
      }

      return {
        isReady: true,
        status: 'connected',
        usedMemoryBytes,
        connectedClients,
      };
    } catch {
      return {
        isReady: true,
        status: 'connected',
      };
    }
  }

  /**
   * Evicts expired or zombie user sessions from online roster.
   */
  static async pruneStaleOnlineSessions(activeUserIds: string[], rosterKey = 'online_users'): Promise<number> {
    if (!redis.isReady) return 0;
    try {
      const stored = await redis.sMembers(rosterKey);
      const activeSet = new Set(activeUserIds);

      const stale = stored.filter((userId) => !activeSet.has(userId));
      if (stale.length > 0) {
        await redis.sRem(rosterKey, stale);
      }
      return stale.length;
    } catch (err) {
      console.error('[RedisHealthService] Stale session pruning failed:', err);
      return 0;
    }
  }
}
