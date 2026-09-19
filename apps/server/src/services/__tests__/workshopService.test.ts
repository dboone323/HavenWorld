import { WorkshopService } from '../WorkshopService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';
import { CRAFTING_RECIPES } from '@havenworld/shared';

describe('WorkshopService', () => {
  afterAll(async () => {
    await truncateAllTables();
  });

  it('should start craft with sufficient materials, deduct materials, and create queue entry', async () => {
    const user = await createTestUser();
    const recipe = CRAFTING_RECIPES[0]; // e.g. recipe requiring timber

    // Give user plenty of materials
    await prisma.materialInventory.create({
      data: {
        userId: user.id,
        timber: 100,
        scrapMetal: 100,
        fabric: 100,
        crystalShard: 100,
      },
    });

    const queueItem = await WorkshopService.startCraft(user.id, recipe.id);
    expect(queueItem).toBeDefined();
    expect(queueItem.userId).toBe(user.id);
    expect(queueItem.recipeId).toBe(recipe.id);
    expect(queueItem.claimed).toBe(false);

    // Verify materials were deducted
    const mats = await prisma.materialInventory.findUnique({ where: { userId: user.id } });
    const timberReq = recipe.materials.find((m) => m.type === 'timber')?.qty || 0;
    expect(mats?.timber).toBe(100 - timberReq);
  });

  it('should throw error and not create a queue entry when materials are insufficient', async () => {
    const user = await createTestUser();
    const recipe = CRAFTING_RECIPES[0];

    // User has 0 materials
    await prisma.materialInventory.create({
      data: {
        userId: user.id,
        timber: 0,
        scrapMetal: 0,
        fabric: 0,
        crystalShard: 0,
      },
    });

    await expect(WorkshopService.startCraft(user.id, recipe.id)).rejects.toThrow(/Insufficient/i);

    const queueItems = await prisma.craftingQueue.findMany({ where: { userId: user.id } });
    expect(queueItems.length).toBe(0);
  });

  it('should throw error when attempting to claim a craft that is not yet completed', async () => {
    const user = await createTestUser();
    const recipe = CRAFTING_RECIPES[0];

    await prisma.materialInventory.create({
      data: { userId: user.id, timber: 50, scrapMetal: 50, fabric: 50, crystalShard: 50 },
    });

    const queueItem = await WorkshopService.startCraft(user.id, recipe.id);

    // Attempting to claim immediately should throw 'Item is still crafting'
    await expect(WorkshopService.claimCraft(user.id, queueItem.id)).rejects.toThrow('Item is still crafting');
  });

  it('should add crafted item to inventory and mark claimed when craft is complete', async () => {
    const user = await createTestUser();
    const recipe = CRAFTING_RECIPES[0];

    // Create a craft entry whose completion date was 1 minute ago
    const pastDate = new Date(Date.now() - 60_000);
    const queueItem = await prisma.craftingQueue.create({
      data: {
        userId: user.id,
        recipeId: recipe.id,
        completesAt: pastDate,
        claimed: false,
      },
    });

    const result = await WorkshopService.claimCraft(user.id, queueItem.id);
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();

    const updatedQueue = await prisma.craftingQueue.findUnique({ where: { id: queueItem.id } });
    expect(updatedQueue?.claimed).toBe(true);

    const inv = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user.id, itemId: recipe.outputItemId } },
    });
    expect(inv).toBeDefined();
    expect(inv?.quantity).toBe(1);
  });

  it('should create independent queue entries for multiple simultaneous crafts', async () => {
    const user = await createTestUser();
    const recipe = CRAFTING_RECIPES[0];

    await prisma.materialInventory.create({
      data: { userId: user.id, timber: 100, scrapMetal: 100, fabric: 100, crystalShard: 100 },
    });

    const item1 = await WorkshopService.startCraft(user.id, recipe.id);
    const item2 = await WorkshopService.startCraft(user.id, recipe.id);

    expect(item1.id).not.toBe(item2.id);

    const userQueue = await prisma.craftingQueue.findMany({ where: { userId: user.id } });
    expect(userQueue.length).toBe(2);
  });
});
