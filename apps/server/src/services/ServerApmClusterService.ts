import os from 'os';
import { prisma } from '../prisma';
import { redisClient } from '../redis';
import { getIO } from '../sockets';
import { roomManager } from './RoomManager';

export interface ApmErrorRecord {
  context: string;
  message: string;
  timestamp: number;
}

export interface ClusterApmSnapshot {
  nodeId: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  timestamp: string;
  uptimeSeconds: number;
  system: {
    hostname: string;
    platform: string;
    arch: string;
    cpus: number;
    loadAverage: number[];
  };
  processMemory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
    externalMb: number;
    heapUtilizationPercentage: number;
  };
  webSockets: {
    connectedSockets: number;
    activeRooms: number;
    totalOccupants: number;
  };
  redis: {
    connected: boolean;
    pingLatencyMs: number | null;
  };
  database: {
    connected: boolean;
    queryLatencyMs: number;
    poolStatus: string;
  };
  errors: {
    recentCount: number;
    recentErrors: ApmErrorRecord[];
  };
}

export class ServerApmClusterService {
  private static recentErrors: ApmErrorRecord[] = [];
  private static readonly MAX_RECENT_ERRORS = 50;
  private static nodeId = `hw-node-${os.hostname()}-${process.pid}`;

  /**
   * Records an application exception into rolling memory ring buffer
   */
  static recordError(context: string, err: any): void {
    const errorRecord: ApmErrorRecord = {
      context,
      message: err?.message || String(err),
      timestamp: Date.now(),
    };

    this.recentErrors.unshift(errorRecord);
    if (this.recentErrors.length > this.MAX_RECENT_ERRORS) {
      this.recentErrors.pop();
    }
  }

  /**
   * Cleans old errors beyond 5 minutes
   */
  static pruneOldErrors(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.recentErrors = this.recentErrors.filter((e) => e.timestamp >= fiveMinutesAgo);
  }

  /**
   * Gathers full APM snapshot across host, memory, socket connections, redis, and database
   */
  static async getClusterApmSnapshot(): Promise<ClusterApmSnapshot> {
    this.pruneOldErrors();

    // 1. Memory metrics
    const mem = process.memoryUsage();
    const rssMb = Math.round((mem.rss / 1024 / 1024) * 100) / 100;
    const heapTotalMb = Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100;
    const heapUsedMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
    const externalMb = Math.round((mem.external / 1024 / 1024) * 100) / 100;
    const heapUtilizationPercentage = Math.round((mem.heapUsed / mem.heapTotal) * 10000) / 100;

    // 2. WebSocket metrics
    const io = getIO();
    let connectedSockets = 0;
    if (io) {
      connectedSockets = io.sockets?.sockets?.size || 0;
    }
    const occupants = roomManager.getAllRoomOccupants();
    let totalOccupants = 0;
    occupants.forEach((count) => {
      totalOccupants += count;
    });

    // 3. Redis Ping Latency
    let redisConnected = false;
    let redisPingLatencyMs: number | null = null;
    if (redisClient.isOpen) {
      redisConnected = true;
      try {
        const t0 = Date.now();
        await redisClient.ping();
        redisPingLatencyMs = Date.now() - t0;
      } catch (err) {
        this.recordError('redis.ping', err);
      }
    }

    // 4. PostgreSQL Query Latency
    let dbConnected = false;
    let dbQueryLatencyMs = 0;
    try {
      const t0 = Date.now();
      await prisma.$queryRawUnsafe('SELECT 1');
      dbQueryLatencyMs = Date.now() - t0;
      dbConnected = true;
    } catch (err) {
      this.recordError('prisma.queryRaw', err);
    }

    // 5. Evaluate Cluster Health Status
    let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
    if (!dbConnected) {
      status = 'UNHEALTHY';
    } else if (!redisConnected || this.recentErrors.length > 10 || heapUtilizationPercentage > 92) {
      status = 'DEGRADED';
    }

    return {
      nodeId: this.nodeId,
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()?.length || 1,
        loadAverage: os.loadavg ? os.loadavg() : [0, 0, 0],
      },
      processMemory: {
        rssMb,
        heapTotalMb,
        heapUsedMb,
        externalMb,
        heapUtilizationPercentage,
      },
      webSockets: {
        connectedSockets,
        activeRooms: occupants.size,
        totalOccupants,
      },
      redis: {
        connected: redisConnected,
        pingLatencyMs: redisPingLatencyMs,
      },
      database: {
        connected: dbConnected,
        queryLatencyMs: dbQueryLatencyMs,
        poolStatus: 'ACTIVE',
      },
      errors: {
        recentCount: this.recentErrors.length,
        recentErrors: this.recentErrors.slice(0, 10),
      },
    };
  }
}
