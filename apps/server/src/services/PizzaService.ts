import { prisma } from '../prisma';
import { MinigameService, RECIPES, type PizzaOrderPayload } from './MinigameService';
import { AnalyticsService } from './AnalyticsService';
import { QuestService } from './QuestService';

export interface PizzaOrderResult {
  tier: 'PERFECT' | 'GOOD' | 'FAIL';
  baseCoins: number;
  score: number;
  streak: number;
  streakMultiplier: number;
  bonusTip: number;
  coinsEarned: number;
  weeklyRemaining: number;
}

/**
 * Service managing Pizza Chef minigame mechanics:
 * Score decay, streak combo multipliers, and coin reward payouts.
 */
export class PizzaService extends MinigameService {
  private static userStreaks = new Map<string, number>();

  static getStreak(userId: string): number {
    return this.userStreaks.get(userId) || 0;
  }

  static resetStreak(userId: string): void {
    this.userStreaks.delete(userId);
  }

  /**
   * Calculates score with realistic kitchen time-decay:
   * - Speed bonus for fast orders under 40% of max time
   * - Smooth decay between 40% and 100% of max time
   * - Overtime decay beyond max time (clamped to floor of 20)
   */
  static calculateOrderScore(
    recipe: 'margherita' | 'funghi_rustica' | 'green_garden' | 'seasonal' | string,
    durationMs: number,
    isCorrectOrder: boolean
  ): number {
    if (!isCorrectOrder) return 0;

    const recipeConfig = RECIPES[recipe] || { maxMs: 20_000 };
    const maxMs = recipeConfig.maxMs;

    if (durationMs <= maxMs * 0.4) {
      // Speed perfection bonus: 105 - 110
      const speedRatio = 1 - durationMs / (maxMs * 0.4);
      return Math.round(100 + speedRatio * 10);
    }

    if (durationMs <= maxMs) {
      // Linear score decay from 100 down to 70
      const timeRemainingRatio = (maxMs - durationMs) / (maxMs * 0.6);
      return Math.round(70 + timeRemainingRatio * 30);
    }

    // Overtime tardy order decays down to floor of 20
    const overtimeRatio = (durationMs - maxMs) / maxMs;
    return Math.max(20, Math.round(70 - overtimeRatio * 50));
  }

  /**
   * Calculates streak multiplier progression:
   * 0 - 1 orders: 1.0x
   * 2 orders: 1.25x
   * 3 - 4 orders: 1.5x
   * 5+ orders: 2.0x (Grand Pizzaiolo)
   */
  static calculateStreakMultiplier(streak: number): number {
    if (streak >= 5) return 2.0;
    if (streak >= 3) return 1.5;
    if (streak >= 2) return 1.25;
    return 1.0;
  }

  /**
   * Submits a pizza chef order with score decay, streak multipliers, and coin reward payouts
   */
  static async submitChefOrder(userId: string, data: PizzaOrderPayload): Promise<PizzaOrderResult> {
    const recipeConfig = RECIPES[data.recipe];
    if (!recipeConfig) throw new Error('Unknown recipe');

    // Anti-bot / time-attack validation:
    const minRequiredMs = Math.max(
      this.MIN_PHYSICAL_DURATION_MS,
      recipeConfig.order.length * 350
    );
    if (data.durationMs < minRequiredMs) {
      throw new Error(
        `ORDER_TOO_FAST: Mini-game completed in ${data.durationMs}ms, faster than physically possible (${minRequiredMs}ms minimum).`
      );
    }

    const isCorrectOrder =
      data.ingredients.length === recipeConfig.order.length &&
      data.ingredients.every((ing, idx) => ing.toLowerCase() === recipeConfig.order[idx]);

    const score = this.calculateOrderScore(data.recipe, data.durationMs, isCorrectOrder);

    let tier: 'PERFECT' | 'GOOD' | 'FAIL' = 'FAIL';
    let baseCoins = 5;

    if (isCorrectOrder) {
      if (data.durationMs <= recipeConfig.maxMs) {
        tier = 'PERFECT';
        baseCoins =
          data.recipe === 'seasonal'
            ? 60
            : data.recipe === 'green_garden'
            ? 45
            : data.recipe === 'funghi_rustica'
            ? 40
            : 30;
      } else {
        tier = 'GOOD';
        baseCoins = 20;
      }
    }

    // Update streak combo
    let streak = this.userStreaks.get(userId) || 0;
    if (tier === 'PERFECT') {
      streak++;
    } else {
      streak = 0;
    }
    this.userStreaks.set(userId, streak);

    const streakMultiplier = this.calculateStreakMultiplier(streak);
    const bonusTip = score >= 100 ? 10 : 0;
    const coinsToAward = Math.round(baseCoins * streakMultiplier) + bonusTip;

    // Enforce rolling 60-minute anti-bot earnings limit (500 coins/hr)
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
          score,
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
          score,
          coinsEarned: actualAward,
          streak,
          durationMs: data.durationMs,
        },
      });

      return {
        tier,
        baseCoins,
        score,
        streak,
        streakMultiplier,
        bonusTip,
        coinsEarned: actualAward,
        weeklyRemaining: Math.max(0, spaceRemaining - actualAward),
      };
    });
  }

  static async trackPizzaOrderSubmit(userId: string, payload?: Record<string, unknown>) {
    await AnalyticsService.trackEvent('PIZZA_ORDER_SUBMIT', { userId, payload });
  }
}
