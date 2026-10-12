import { prisma } from '../prisma';

export interface DatabaseTelemetryReport {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  timestamp: string;
  pingLatencyMs: number;
  serverTime: string;
  tableCounts: {
    users: number;
    rooms: number;
    inventories: number;
    fishCatches: number;
    craftingQueues: number;
    tradeLogs: number;
    gameEvents: number;
  };
  storageMetrics: {
    totalEntitiesTracked: number;
    isWriteCapable: boolean;
  };
  benchmark: {
    readLatencyMs: number;
    writeLatencyMs: number;
  };
}

/**
 * Service managing automated database health and telemetry reporting
 */
export class DatabaseHealthTelemetryService {
  /**
   * Generates a comprehensive database health and volume telemetry report
   */
  static async getTelemetryReport(): Promise<DatabaseTelemetryReport> {
    const startPing = Date.now();
    let isWriteCapable = false;

    // Ping & server time
    const [rawPing] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() as now`;
    const pingLatencyMs = Date.now() - startPing;
    const serverTime = rawPing?.now ? new Date(rawPing.now).toISOString() : new Date().toISOString();

    // Table counts
    const [users, rooms, inventories, fishCatches, craftingQueues, tradeLogs, gameEvents] =
      await Promise.all([
        prisma.user.count(),
        prisma.room.count(),
        prisma.inventory.count(),
        prisma.fishCatch.count(),
        prisma.craftingQueue.count(),
        prisma.tradeLog.count(),
        prisma.gameEvent.count(),
      ]);

    const totalEntitiesTracked =
      users + rooms + inventories + fishCatches + craftingQueues + tradeLogs + gameEvents;

    // Benchmark read & write latencies
    const benchmark = await this.benchmarkReadWriteLatency();
    isWriteCapable = benchmark.writeLatencyMs >= 0;

    const status: 'HEALTHY' | 'DEGRADED' | 'DOWN' =
      pingLatencyMs < 200 && isWriteCapable
        ? 'HEALTHY'
        : pingLatencyMs < 1000
        ? 'DEGRADED'
        : 'DOWN';

    return {
      status,
      timestamp: new Date().toISOString(),
      pingLatencyMs,
      serverTime,
      tableCounts: {
        users,
        rooms,
        inventories,
        fishCatches,
        craftingQueues,
        tradeLogs,
        gameEvents,
      },
      storageMetrics: {
        totalEntitiesTracked,
        isWriteCapable,
      },
      benchmark,
    };
  }

  /**
   * Measures actual read and write throughput latencies in PostgreSQL
   */
  static async benchmarkReadWriteLatency(): Promise<{
    readLatencyMs: number;
    writeLatencyMs: number;
  }> {
    // 1. Read benchmark
    const readStart = Date.now();
    await prisma.user.findFirst({ select: { id: true } });
    const readLatencyMs = Date.now() - readStart;

    // 2. Write benchmark using a lightweight GameEvent write & cleanup
    let writeLatencyMs = -1;
    try {
      const writeStart = Date.now();
      const testEvent = await prisma.gameEvent.create({
        data: {
          event: 'HEALTH_TELEMETRY_BENCHMARK',
          payload: { timestamp: Date.now() },
        },
      });
      writeLatencyMs = Date.now() - writeStart;

      // Clean up benchmark row
      await prisma.gameEvent.delete({ where: { id: testEvent.id } });
    } catch (err) {
      console.warn('[DatabaseHealthTelemetryService] Write benchmark failed:', err);
    }

    return {
      readLatencyMs,
      writeLatencyMs,
    };
  }
}
