import { prisma } from '../../prisma';
import { InventoryService } from '../InventoryService';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 48: Inventory Bulk Item Recycling, Salvage Materials, and Scrap Yield Formulas', () => {
  let userId: string;
  let rareItemId: string;
  let epicItemId: string;
  const svc = new InventoryService();

  beforeAll(async () => {
    const user = await createTestUser({ havenCoins: 0 });
    userId = user.id;

    // Create a RARE item and an EPIC item that are NOT free starters
    const rareItem = await prisma.item.upsert({
      where: { id: 'test-rare-sword-b48' },
      create: {
        id: 'test-rare-sword-b48',
        name: 'Rare Sword B48',
        description: 'Test rare item',
        category: 'DECORATION',
        rarity: 'RARE',
        price: 200,
        spriteKey: 'rare-sword',
      },
      update: {},
    });
    rareItemId = rareItem.id;

    const epicItem = await prisma.item.upsert({
      where: { id: 'test-epic-cloak-b48' },
      create: {
        id: 'test-epic-cloak-b48',
        name: 'Epic Cloak B48',
        description: 'Test epic item',
        category: 'DECORATION',
        rarity: 'EPIC',
        price: 500,
        spriteKey: 'epic-cloak',
      },
      update: {},
    });
    epicItemId = epicItem.id;
  });

  afterAll(async () => {
    await prisma.inventory.deleteMany({ where: { userId } });
    await prisma.avatar.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.item.deleteMany({ where: { id: { in: [rareItemId, epicItemId] } } });
  });

  it('scrap yield formula returns correct coins per rarity tier', () => {
    expect(InventoryService.scrapYieldForRarity('COMMON')).toBe(5);
    expect(InventoryService.scrapYieldForRarity('UNCOMMON')).toBe(15);
    expect(InventoryService.scrapYieldForRarity('RARE')).toBe(40);
    expect(InventoryService.scrapYieldForRarity('EPIC')).toBe(100);
    expect(InventoryService.scrapYieldForRarity('LEGENDARY')).toBe(250);
  });

  it('recycleItem removes item from inventory and credits correct coins', async () => {
    // Give user 1 rare item
    await svc.addItem(userId, rareItemId, 1);

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { havenCoins: true } });
    const result = await svc.recycleItem(userId, rareItemId, 1);

    expect(result.coinsAwarded).toBe(40); // RARE = 40
    expect(result.rarityTier).toBe('RARE');
    expect(result.quantityRecycled).toBe(1);

    const after = await prisma.user.findUnique({ where: { id: userId }, select: { havenCoins: true } });
    expect(after!.havenCoins).toBe((before?.havenCoins ?? 0) + 40);

    // Item should be gone from inventory
    const inv = await svc.getUserInventory(userId);
    expect(inv.some((e) => e.itemId === rareItemId)).toBe(false);
  });

  it('bulkRecycle processes multiple items and returns aggregate coins', async () => {
    // Give user 1 of each
    await svc.addItem(userId, rareItemId, 1);
    await svc.addItem(userId, epicItemId, 1);

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { havenCoins: true } });
    const result = await svc.bulkRecycle(userId, [
      { itemId: rareItemId, quantity: 1 },
      { itemId: epicItemId, quantity: 1 },
    ]);

    // RARE(40) + EPIC(100) = 140
    expect(result.totalCoinsAwarded).toBe(140);
    expect(result.recycled).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    const after = await prisma.user.findUnique({ where: { id: userId }, select: { havenCoins: true } });
    expect(after!.havenCoins).toBe((before?.havenCoins ?? 0) + 140);
  });

  it('bulkRecycle skips starter items without aborting the batch', async () => {
    const starterItem = 'furniture-chair'; // in DEFAULT_FREE_ITEM_IDS
    await svc.addItem(userId, epicItemId, 1);

    const result = await svc.bulkRecycle(userId, [
      { itemId: starterItem, quantity: 1 },
      { itemId: epicItemId, quantity: 1 },
    ]);

    expect(result.skipped).toContain(starterItem);
    expect(result.recycled.some((r) => r.itemId === epicItemId)).toBe(true);
    expect(result.totalCoinsAwarded).toBe(100); // only epic goes through
  });

  it('salvageDuplicates converts excess duplicate stacks into coins per rarity', async () => {
    // Give user 3 epic items (salvage should reduce to 1, yield 2 × 100 = 200 coins)
    await svc.addItem(userId, epicItemId, 3);
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { havenCoins: true } });

    const summary = await svc.salvageDuplicates(userId);

    expect(summary.itemsSalvaged).toBeGreaterThanOrEqual(2);
    expect(summary.totalCoinsAwarded).toBeGreaterThanOrEqual(200);
    expect(summary.tierBreakdown['EPIC']).toBeDefined();
    expect(summary.tierBreakdown['EPIC'].coins).toBeGreaterThanOrEqual(200);

    const after = await prisma.user.findUnique({ where: { id: userId }, select: { havenCoins: true } });
    expect(after!.havenCoins).toBeGreaterThan(before?.havenCoins ?? 0);

    // Inventory should show quantity = 1 for the epic item
    const inv = await svc.getUserInventory(userId);
    const entry = inv.find((e) => e.itemId === epicItemId);
    expect(entry?.quantity).toBe(1);
  });
});
