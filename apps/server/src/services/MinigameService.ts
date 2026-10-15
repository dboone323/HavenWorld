import { prisma } from '../prisma';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';
import { AnalyticsService } from './AnalyticsService';

export interface PizzaOrderPayload {
  recipe: 'margherita' | 'funghi_rustica' | 'green_garden' | 'seasonal';
  ingredients: string[];
  durationMs: number;
}

export const RECIPES: Record<string, { order: string[]; maxMs: number }> = {
  margherita: {
    order: ['dough', 'sauce', 'mozzarella'],
    maxMs: 15_000,
  },
  funghi_rustica: {
    order: ['dough', 'sauce', 'mushrooms', 'mozzarella'],
    maxMs: 20_000,
  },
  green_garden: {
    order: ['dough', 'basil_pesto', 'zucchini', 'spinach'],
    maxMs: 22_000,
  },
  seasonal: {
    order: ['dough', 'pumpkin_puree', 'sage', 'mozzarella'],
    maxMs: 25_000,
  },
};

export class MinigameService {
  private static userCombos = new Map<string, number>();
  private static activeOrderTimers = new Map<string, { recipe: string; startedAt: number }>();

  public static readonly MIN_PHYSICAL_DURATION_MS = 1500;

  /**
   * Records the server-side start timestamp when a player begins assembling a pizza order.
   */
  static startOrder(
    userId: string,
    recipe: 'margherita' | 'funghi_rustica' | 'green_garden' | 'seasonal'
  ): void {
    this.activeOrderTimers.set(userId, { recipe, startedAt: Date.now() });
  }

  static getActiveOrder(userId: string): { recipe: string; startedAt: number } | undefined {
    return this.activeOrderTimers.get(userId);
  }

  static clearActiveOrder(userId: string): void {
    this.activeOrderTimers.delete(userId);
  }

  /**
   * Validates pizza order assembly server-side and awards coins up to weekly cap
   */
  static async submitPizzaOrder(userId: string, data: PizzaOrderPayload) {
    const recipeConfig = RECIPES[data.recipe];
    if (!recipeConfig) throw new Error('Unknown recipe');

    // Anti-bot / time-attack validation:
    // Reject submissions faster than physically possible (< 1500ms or < 350ms per ingredient)
    const minRequiredMs = Math.max(
      this.MIN_PHYSICAL_DURATION_MS,
      recipeConfig.order.length * 350
    );
    if (data.durationMs < minRequiredMs) {
      throw new Error(
        `ORDER_TOO_FAST: Mini-game completed in ${data.durationMs}ms, faster than physically possible (${minRequiredMs}ms minimum).`
      );
    }

    const tracked = this.activeOrderTimers.get(userId);
    if (tracked) {
      const serverElapsedMs = Date.now() - tracked.startedAt;
      this.activeOrderTimers.delete(userId);

      // Verify server-side elapsed time prevents spoofed client durationMs
      if (serverElapsedMs < minRequiredMs * 0.8) {
        throw new Error(
          `ORDER_TOO_FAST: Server recorded elapsed time of ${serverElapsedMs}ms (minimum ${minRequiredMs}ms).`
        );
      }
    }

    // Validate ingredient order
    const isCorrectOrder =
      data.ingredients.length === recipeConfig.order.length &&
      data.ingredients.every((ing, idx) => ing.toLowerCase() === recipeConfig.order[idx]);

    let tier: 'PERFECT' | 'GOOD' | 'FAIL' = 'FAIL';
    let baseCoins = 5;

    if (isCorrectOrder) {
      if (data.durationMs <= recipeConfig.maxMs) {
        tier = 'PERFECT';
        baseCoins = data.recipe === 'seasonal' ? 60 : 30;
      } else {
        tier = 'GOOD';
        baseCoins = 20;
      }
    }

    // Update combo
    let combo = this.userCombos.get(userId) || 0;
    if (tier === 'PERFECT') combo++;
    else combo = 0;
    this.userCombos.set(userId, combo);

    const multiplier = combo >= 3 ? 1.5 : 1.0;
    const coinsToAward = Math.round(baseCoins * multiplier);

    // Track 6.2: Enforce rolling 60-minute anti-bot earnings limit (500 coins/hr)
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const hourlySessions = await prisma.minigameSession.aggregate({
      where: {
        userId,
        completedAt: { gte: oneHourAgo },
      },
      _sum: { coinsEarned: true },
    });

    const hourlyTotal = hourlySessions._sum?.coinsEarned ?? 0;
    const MAX_HOURLY = 500;
    if (hourlyTotal >= MAX_HOURLY) {
      throw new Error(`HOURLY_LIMIT_EXCEEDED: Maximum earnings rate of ${MAX_HOURLY} coins/hour from minigames reached.`);
    }

    // Enforce weekly earnings cap (2,000 coins max per week)
    const startOfWeek = new Date();
    startOfWeek.setUTCHours(0, 0, 0, 0);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());

    return await prisma.$transaction(async (tx) => {
      let capRecord = await tx.weeklyEarningsCap.findUnique({
        where: {
          userId_gameType_weekOf: {
            userId,
            gameType: 'PIZZA_CHEF',
            weekOf: startOfWeek,
          },
        },
      });

      if (!capRecord) {
        capRecord = await tx.weeklyEarningsCap.create({
          data: {
            userId,
            gameType: 'PIZZA_CHEF',
            earned: 0,
            weekOf: startOfWeek,
          },
        });
      }

      const MAX_WEEKLY = 2000;
      const spaceRemaining = Math.max(0, MAX_WEEKLY - capRecord.earned);
      const actualAward = Math.min(coinsToAward, spaceRemaining);

      if (actualAward > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { havenCoins: { increment: actualAward } },
        });

        await tx.weeklyEarningsCap.update({
          where: { id: capRecord.id },
          data: { earned: { increment: actualAward } },
        });
      }

      // Record session
      await tx.minigameSession.create({
        data: {
          userId,
          gameType: 'PIZZA_CHEF',
          coinsEarned: actualAward,
          score: tier === 'PERFECT' ? 100 : tier === 'GOOD' ? 70 : 20,
          duration: Math.round(data.durationMs / 1000),
        },
      });

      if (tier === 'PERFECT') {
        await QuestService.incrementProgress(userId, 'PIZZA_PERFECT', 1);
      }

      void AnalyticsService.trackEvent('PIZZA_ORDER_SUBMIT', {
        userId,
        payload: {
          recipe: data.recipe,
          tier,
          coinsEarned: actualAward,
          combo,
          durationMs: data.durationMs,
        },
      });

      return {
        tier,
        coinsEarned: actualAward,
        combo,
        weeklyRemaining: Math.max(0, spaceRemaining - actualAward),
      };
    });
  }
}
