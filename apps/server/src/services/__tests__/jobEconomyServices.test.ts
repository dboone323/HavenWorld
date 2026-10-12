import { PizzaService } from '../PizzaService';
import { CraftingService } from '../CraftingService';
import { prisma } from '../../prisma';

async function getOrCreateTestUser() {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: `job_${Date.now()}_${Math.random().toString(36).substring(7)}@havenworld.game`,
        username: `Job_${Date.now().toString().slice(-4)}`,
        passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      },
    });
  }
  return user;
}

describe('Batch 6: Job Economy Services (Pizza & Crafting)', () => {
  it('PizzaService evaluates pizza order submit and calculates correct tier awards', async () => {
    const user = await getOrCreateTestUser();

    const orderResult = await PizzaService.submitPizzaOrder(user.id, {
      recipe: 'margherita',
      ingredients: ['dough', 'sauce', 'mozzarella'],
      durationMs: 8000,
    });

    expect(orderResult).toHaveProperty('tier');
    expect(orderResult.tier).toBe('PERFECT');
    expect(orderResult.coinsEarned).toBeGreaterThan(0);
    expect(typeof orderResult.combo).toBe('number');
  });

  it('CraftingService tracks craft events and processes completions', async () => {
    const user = await getOrCreateTestUser();

    await CraftingService.trackCraftItem(user.id, { recipeId: 'chair_wood' });
    const completed = await CraftingService.processCompletedCrafts(new Date());
    expect(typeof completed).toBe('number');
  });

  describe('Batch 23: Pizza Chef Minigame Score Decay & Streak Multipliers', () => {
    it('calculateOrderScore computes speed bonuses, linear time decay, and overtime floor', () => {
      // Wrong ingredients -> score 0
      expect(PizzaService.calculateOrderScore('margherita', 5000, false)).toBe(0);

      // Fast delivery under 40% time (maxMs is 15000, 40% is 6000) -> bonus score >= 100
      const fastScore = PizzaService.calculateOrderScore('margherita', 3000, true);
      expect(fastScore).toBeGreaterThanOrEqual(100);

      // Standard delivery (halfway through -> linear decay between 70 and 100)
      const midScore = PizzaService.calculateOrderScore('margherita', 10500, true);
      expect(midScore).toBeGreaterThanOrEqual(70);
      expect(midScore).toBeLessThan(100);

      // Overtime delivery (past maxMs) decays down towards 20 floor
      const lateScore = PizzaService.calculateOrderScore('margherita', 25000, true);
      expect(lateScore).toBeGreaterThanOrEqual(20);
      expect(lateScore).toBeLessThan(70);
    });

    it('calculateStreakMultiplier correctly scales through streak tiers', () => {
      expect(PizzaService.calculateStreakMultiplier(0)).toBe(1.0);
      expect(PizzaService.calculateStreakMultiplier(1)).toBe(1.0);
      expect(PizzaService.calculateStreakMultiplier(2)).toBe(1.25);
      expect(PizzaService.calculateStreakMultiplier(3)).toBe(1.5);
      expect(PizzaService.calculateStreakMultiplier(4)).toBe(1.5);
      expect(PizzaService.calculateStreakMultiplier(5)).toBe(2.0);
      expect(PizzaService.calculateStreakMultiplier(10)).toBe(2.0);
    });

    it('submitChefOrder builds streaks, applies multipliers and bonus tip, and awards havenCoins', async () => {
      const user = await getOrCreateTestUser();
      PizzaService.resetStreak(user.id);
      expect(PizzaService.getStreak(user.id)).toBe(0);

      const initialCoins = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).havenCoins;

      // First order: Fast margherita -> perfect, streak 1, speed bonus tip
      const order1 = await PizzaService.submitChefOrder(user.id, {
        recipe: 'margherita',
        ingredients: ['dough', 'sauce', 'mozzarella'],
        durationMs: 4000,
      });

      expect(order1.tier).toBe('PERFECT');
      expect(order1.streak).toBe(1);
      expect(order1.streakMultiplier).toBe(1.0);
      expect(order1.score).toBeGreaterThanOrEqual(100);
      expect(order1.bonusTip).toBe(10);
      expect(order1.coinsEarned).toBe(40); // 30 base * 1.0 + 10 tip

      // Second order: another perfect margherita -> streak 2, 1.25x multiplier
      const order2 = await PizzaService.submitChefOrder(user.id, {
        recipe: 'margherita',
        ingredients: ['dough', 'sauce', 'mozzarella'],
        durationMs: 4000,
      });

      expect(order2.streak).toBe(2);
      expect(order2.streakMultiplier).toBe(1.25);
      expect(order2.coinsEarned).toBe(48); // Math.round(30 * 1.25) = 38 + 10 tip = 48

      // Verify DB coin balance updated
      const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(updatedUser.havenCoins).toBe(initialCoins + order1.coinsEarned + order2.coinsEarned);

      // Failing an order resets streak to 0
      const orderFail = await PizzaService.submitChefOrder(user.id, {
        recipe: 'margherita',
        ingredients: ['dough', 'wrong_topping'],
        durationMs: 5000,
      });

      expect(orderFail.tier).toBe('FAIL');
      expect(orderFail.streak).toBe(0);
      expect(PizzaService.getStreak(user.id)).toBe(0);
    });
  });
});
