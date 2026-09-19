import { prisma } from '../prisma';

export interface TrackEventArgs {
  userId?: string | null;
  sessionId?: string | null;
  roomId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface DauPoint {
  day: string;
  users: number;
}

export interface SessionLengthStats {
  sessions: number;
  averageSeconds: number;
  medianSeconds: number;
  longestSeconds: number;
}

export interface RoomPopularityPoint {
  roomId: string;
  roomName: string;
  visits: number;
}

export interface EconomySnapshot {
  coinSupply: number;
  faucets: { source: string; amount: number }[];
  sinks: { source: string; amount: number }[];
  netFlow: number;
}

export interface MinigameStats {
  event: string;
  plays: number;
  players: number;
}

/**
 * Product analytics (Part 9B §1).
 *
 * `trackEvent` is deliberately fire-and-forget: telemetry must never throw into a
 * player-facing request path, so every failure is swallowed and logged. Reads are
 * served to the admin dashboard via `/api/admin/analytics/*`.
 */
export class AnalyticsService {
  /** Records a single gameplay event. Never throws. */
  static async trackEvent(event: string, args: TrackEventArgs = {}): Promise<void> {
    try {
      await prisma.gameEvent.create({
        data: {
          event,
          userId: args.userId ?? null,
          sessionId: args.sessionId ?? null,
          roomId: args.roomId ?? null,
          payload: args.payload ? (args.payload as object) : undefined,
        },
      });
    } catch (err) {
      console.warn(`[Analytics] Failed to record ${event}:`, err);
    }
  }

  /** Daily active users over a trailing window. */
  static async dau(days = 14): Promise<DauPoint[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await prisma.$queryRaw<{ day: Date; users: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(DISTINCT "userId") AS users
      FROM "game_events"
      WHERE "createdAt" >= ${since} AND "userId" IS NOT NULL
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      users: Number(row.users),
    }));
  }

  /** Session length distribution derived from event timestamps per sessionId. */
  static async sessionLengths(days = 7): Promise<SessionLengthStats> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await prisma.$queryRaw<{ seconds: number | null }[]>`
      SELECT EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt"))) AS seconds
      FROM "game_events"
      WHERE "createdAt" >= ${since} AND "sessionId" IS NOT NULL
      GROUP BY "sessionId"
    `;

    const lengths = rows
      .map((row) => Number(row.seconds ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);

    if (lengths.length === 0) {
      return { sessions: 0, averageSeconds: 0, medianSeconds: 0, longestSeconds: 0 };
    }

    const total = lengths.reduce((sum, value) => sum + value, 0);
    const middle = Math.floor(lengths.length / 2);

    return {
      sessions: lengths.length,
      averageSeconds: Math.round(total / lengths.length),
      medianSeconds: Math.round(
        lengths.length % 2 === 0 ? (lengths[middle - 1] + lengths[middle]) / 2 : lengths[middle]
      ),
      longestSeconds: Math.round(lengths[lengths.length - 1]),
    };
  }

  /** Rooms ordered by visit count in the window. */
  static async roomPopularity(days = 7): Promise<RoomPopularityPoint[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await prisma.gameEvent.groupBy({
      by: ['roomId'],
      where: { createdAt: { gte: since }, roomId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { roomId: 'desc' } },
      take: 20,
    });

    const roomIds = grouped.map((row) => row.roomId).filter((id): id is string => Boolean(id));
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(rooms.map((room) => [room.id, room.name]));

    const result: RoomPopularityPoint[] = [];
    for (const row of grouped) {
      if (!row.roomId) continue;
      result.push({
        roomId: row.roomId,
        roomName: nameById.get(row.roomId) ?? 'Unknown room',
        visits: row._count._all,
      });
    }
    return result;
  }

  /** Coin supply plus faucet/sink totals from the transaction ledger. */
  static async economyHealth(days = 7): Promise<EconomySnapshot> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [supply, flows] = await Promise.all([
      prisma.user.aggregate({ _sum: { havenCoins: true } }),
      prisma.transactionLog.groupBy({
        by: ['type'],
        where: { timestamp: { gte: since } },
        _sum: { amount: true },
      }),
    ]);

    const sinkTypes = new Set(['PURCHASE', 'SHOP_PURCHASE', 'TIP', 'TRADE_FEE', 'LOFT_EXPANSION']);
    const faucets: { source: string; amount: number }[] = [];
    const sinks: { source: string; amount: number }[] = [];
    let netFlow = 0;

    for (const flow of flows) {
      const amount = flow._sum.amount ?? 0;
      if (sinkTypes.has(flow.type)) {
        sinks.push({ source: flow.type, amount });
        netFlow -= amount;
      } else {
        faucets.push({ source: flow.type, amount });
        netFlow += amount;
      }
    }

    return {
      coinSupply: supply._sum.havenCoins ?? 0,
      faucets,
      sinks,
      netFlow,
    };
  }

  /** Mini-game participation counts for the window. */
  static async minigameStats(days = 7): Promise<MinigameStats[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tracked = ['FISH_CAUGHT', 'FISH_CAST', 'PIZZA_ORDER_SUBMIT', 'CRAFT_ITEM'];

    const grouped = await prisma.gameEvent.groupBy({
      by: ['event'],
      where: { createdAt: { gte: since }, event: { in: tracked } },
      _count: { _all: true },
    });

    const players = await Promise.all(
      tracked.map(async (event) => {
        const rows = await prisma.$queryRaw<{ players: bigint }[]>`
          SELECT COUNT(DISTINCT "userId") AS players
          FROM "game_events"
          WHERE "event" = ${event} AND "createdAt" >= ${since} AND "userId" IS NOT NULL
        `;
        return { event, players: Number(rows[0]?.players ?? 0) };
      })
    );

    return tracked.map((event) => ({
      event,
      plays: grouped.find((row) => row.event === event)?._count._all ?? 0,
      players: players.find((row) => row.event === event)?.players ?? 0,
    }));
  }
}