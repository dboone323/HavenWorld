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
});
