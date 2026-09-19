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
    return await prisma.seasonalProgress.upsert({
      where: {
        userId_eventId: { userId, eventId },
      },
      create: {
        userId,
        eventId,
        currency: currencyAmount,
        tier: Math.floor(currencyAmount / 100),
      },
      update: {
        currency: { increment: currencyAmount },
        tier: {
          set: Math.floor(currencyAmount / 100),
        },
      },
    });
  }

  /**
   * Cron entry point (daily): closes events whose end date has passed and converts
   * every participant's leftover seasonal currency into HavenCoins at 1:1, per the
   * Part 6 §12 design ("converts to HavenCoins 1:1 at event end").
   */
  static async convertExpiredEvents(now: Date = new Date()) {
    const expired = await prisma.seasonalEvent.findMany({
      where: { isActive: true, endsAt: { lt: now } },
      include: { progress: true },
    });

    let convertedEvents = 0;
    let coinsIssued = 0;

    for (const event of expired) {
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
