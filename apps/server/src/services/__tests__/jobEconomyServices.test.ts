import { PizzaService } from '../PizzaService';
import { CraftingService } from '../CraftingService';
import { prisma } from '../../prisma';

describe('Batch 6: Job Economy Services (Pizza & Crafting)', () => {
  it('PizzaService evaluates pizza order submit and calculates correct tier awards', async () => {
    const user = await prisma.user.findFirst();
    expect(user).toBeDefined();

    const orderResult = await PizzaService.submitPizzaOrder(user!.id, {
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
    const user = await prisma.user.findFirst();
    expect(user).toBeDefined();

    await CraftingService.trackCraftItem(user!.id, { recipeId: 'chair_wood' });
    const completed = await CraftingService.processCompletedCrafts(new Date());
    expect(typeof completed).toBe('number');
  });
});
