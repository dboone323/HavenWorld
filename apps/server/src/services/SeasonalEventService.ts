import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export class SeasonalEventService {
  /**
   * Retrieves the currently active seasonal event or null
   */
  static async getActiveEvent() {
    const now = new Date();
    return await prisma.seasonalEvent.findFirst({
      where: {
        startsAt: { lte: now },
        endsAt: { gte: now },
        isActive: true,
      },
    });
  }

  /**
   * Advances player's seasonal progress and tier
   */
  static async addProgress(userId: string, eventId: string, currencyAmount: number) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.seasonalProgress.findUnique({
        where: { userId_eventId: { userId, eventId } },
      });
      const newCurrency = (existing?.currency ?? 0) + currencyAmount;
      const newTier = Math.floor(newCurrency / 100);

      if (!existing) {
        return await tx.seasonalProgress.create({
          data: {
            userId,
            eventId,
            currency: newCurrency,
            tier: newTier,
          },
        });
      }

      return await tx.seasonalProgress.update({
        where: { id: existing.id },
        data: {
          currency: newCurrency,
          tier: newTier,
        },
      });
    });
  }

  /**
   * Retrieves live seasonal event leaderboard sorted by tier desc, currency desc
   */
  static async getLeaderboard(eventId: string, limit: number = 50) {
    return await prisma.seasonalProgress.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
      },
      orderBy: [{ tier: 'desc' }, { currency: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  /**
   * Archives leaderboard on event close and awards podium bonuses:
   * Rank 1: 500 HavenCoins
   * Rank 2: 300 HavenCoins
   * Rank 3: 150 HavenCoins
   */
  static async archiveLeaderboard(eventId: string) {
    const leaderboard = await this.getLeaderboard(eventId, 10);
    const bonuses = [500, 300, 150];

    const podiumAwards = [];
    for (let i = 0; i < Math.min(leaderboard.length, bonuses.length); i++) {
      const entry = leaderboard[i];
      const bonus = bonuses[i];
      await prisma.user.update({
        where: { id: entry.userId },
        data: { havenCoins: { increment: bonus } },
      });
      await prisma.transactionLog.create({
        data: {
          receiverId: entry.userId,
          amount: bonus,
          type: 'SEASONAL_PODIUM_AWARD',
          source: `${eventId} Rank ${i + 1}`,
        },
      });
      podiumAwards.push({
        rank: i + 1,
        userId: entry.userId,
        username: entry.user.username,
        bonusCoins: bonus,
      });
    }

    return {
      eventId,
      archivedAt: new Date(),
      totalParticipants: leaderboard.length,
      podiumAwards,
    };
  }

  /**
   * Cron entry point (daily): closes events whose end date has passed, archives
   * leaderboards with podium awards, and converts leftover seasonal currency into
   * HavenCoins at 1:1, per Part 6 §12 design.
   */
  static async convertExpiredEvents(now: Date = new Date()) {
    const expired = await prisma.seasonalEvent.findMany({
      where: { isActive: true, endsAt: { lt: now } },
      include: { progress: true },
    });

    let convertedEvents = 0;
    let coinsIssued = 0;

    for (const event of expired) {
      await this.archiveLeaderboard(event.id);

      await prisma.$transaction(async (tx) => {
        for (const progress of event.progress) {
          if (progress.currency <= 0) continue;

          await tx.user.update({
            where: { id: progress.userId },
            data: { havenCoins: { increment: progress.currency } },
          });
          await tx.transactionLog.create({
            data: {
              receiverId: progress.userId,
              amount: progress.currency,
              type: 'SEASONAL_CONVERSION',
              source: event.id,
            },
          });
          await tx.seasonalProgress.update({
            where: { id: progress.id },
            data: { currency: 0 },
          });

          coinsIssued += progress.currency;
        }

        await tx.seasonalEvent.update({
          where: { id: event.id },
          data: { isActive: false },
        });
      });

      convertedEvents++;
      getIO()?.emit(SOCKET_EVENTS.SEASON_FINALIZED, {
        eventId: event.id,
        name: event.name,
        conversionRate: 1,
      });
    }

    if (convertedEvents > 0) {
      console.log(
        `[Seasonal] Finalized ${convertedEvents} event(s); converted ${coinsIssued} seasonal currency to HavenCoins`
      );
    }

    return { convertedEvents, coinsIssued };
  }
}
