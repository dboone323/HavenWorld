import { prisma } from '../prisma';

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
}
