import { WorkshopService } from '../WorkshopService';
import { CraftingService } from '../CraftingService';
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

  describe('Batch 24: CraftingService Recipe Unlocks & Queue Slot Expansions', () => {
    afterEach(async () => {
      // Clean up any test crafting queues
    });

    it('validates recipe unlock requirements (common is unlocked, rare requires unlock)', async () => {
      const user = await createTestUser();
      CraftingService.resetRecipeUnlocks(user.id);

      const commonRecipe = CRAFTING_RECIPES.find((r) => r.rarity === 'COMMON')!;
      const rareRecipe = CRAFTING_RECIPES.find((r) => r.rarity === 'RARE')!;

      // Common recipe is unlocked by default
      const commonUnlocked = await CraftingService.isRecipeUnlocked(user.id, commonRecipe.id);
      expect(commonUnlocked).toBe(true);

      // Rare recipe is locked by default
      const rareUnlockedBefore = await CraftingService.isRecipeUnlocked(user.id, rareRecipe.id);
      expect(rareUnlockedBefore).toBe(false);

      // Attempting to craft a locked recipe throws an error
      await expect(CraftingService.startCraft(user.id, rareRecipe.id)).rejects.toThrow(
        /locked\. Unlock requirement not met/i
      );

      // Unlocking the rare recipe succeeds
      const unlockRes = await CraftingService.unlockRecipe(user.id, rareRecipe.id);
      expect(unlockRes.success).toBe(true);
      expect(unlockRes.recipeId).toBe(rareRecipe.id);

      const rareUnlockedAfter = await CraftingService.isRecipeUnlocked(user.id, rareRecipe.id);
      expect(rareUnlockedAfter).toBe(true);
    });

    it('enforces queue slot limits and allows expansion up to maximum capacity', async () => {
      const user = await createTestUser();
      CraftingService.resetQueueSlots(user.id);

      // Base capacity should be 2
      const baseMax = await CraftingService.getUserMaxQueueSlots(user.id);
      expect(baseMax).toBe(2);

      const commonRecipe = CRAFTING_RECIPES.find((r) => r.rarity === 'COMMON')!;

      // Give user enough materials for multiple crafts
      await prisma.materialInventory.create({
        data: {
          userId: user.id,
          timber: 200,
          scrapMetal: 200,
          fabric: 200,
          crystalShard: 200,
        },
      });

      // Craft 1 and 2 fill the base slots
      const c1 = await CraftingService.startCraft(user.id, commonRecipe.id);
      const c2 = await CraftingService.startCraft(user.id, commonRecipe.id);
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();

      const status = await CraftingService.getQueueSlotStatus(user.id);
      expect(status.activeCount).toBe(2);
      expect(status.maxSlots).toBe(2);
      expect(status.availableSlots).toBe(0);

      // Attempting a 3rd craft exceeds base capacity and throws
      await expect(CraftingService.startCraft(user.id, commonRecipe.id)).rejects.toThrow(
        /Crafting queue is full/i
      );

      // Expand queue by 1 slot
      const expandRes = await CraftingService.expandQueueSlots(user.id, 1);
      expect(expandRes.currentSlots).toBe(3);

      // Now 3rd craft succeeds!
      const c3 = await CraftingService.startCraft(user.id, commonRecipe.id);
      expect(c3).toBeDefined();

      // Check slot status
      const updatedStatus = await CraftingService.getQueueSlotStatus(user.id);
      expect(updatedStatus.activeCount).toBe(3);
      expect(updatedStatus.maxSlots).toBe(3);

      // Expand to max limit (5)
      await CraftingService.expandQueueSlots(user.id, 2);
      const maxSlots = await CraftingService.getUserMaxQueueSlots(user.id);
      expect(maxSlots).toBe(5);

      // Cannot expand beyond max capacity
      await expect(CraftingService.expandQueueSlots(user.id, 1)).rejects.toThrow(
        /Cannot expand beyond maximum capacity/i
      );
    });
  });
});
