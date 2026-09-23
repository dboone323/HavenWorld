import { prisma } from '../prisma';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

interface PizzaOrderPayload {
  recipe: 'margherita' | 'funghi_rustica' | 'green_garden' | 'seasonal';
  ingredients: string[];
  durationMs: number;
}

const RECIPES: Record<string, { order: string[]; maxMs: number }> = {
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

  /**
   * Validates pizza order assembly server-side and awards coins up to weekly cap
   */
  static async submitPizzaOrder(userId: string, data: PizzaOrderPayload) {
    const recipeConfig = RECIPES[data.recipe];
    if (!recipeConfig) throw new Error('Unknown recipe');

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

      return {
        tier,
        coinsEarned: actualAward,
        combo,
        weeklyRemaining: Math.max(0, spaceRemaining - actualAward),
      };
    });
  }
}
