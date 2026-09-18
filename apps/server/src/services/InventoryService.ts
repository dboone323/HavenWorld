import { prisma } from '../prisma';

const DEFAULT_FREE_ITEM_IDS = [
  'hair-short-01',
  'hair-short-02',
  'hair-long-01',
  'eyes-default',
  'eyes-round',
  'shirt-white',
  'shirt-black',
  'shirt-blue',
  'pants-blue',
  'pants-black',
  'shoes-white',
  'shoes-black',
  'furniture-chair',
  'furniture-table',
  'furniture-plant',
  'furniture-rug',
  'furniture-lamp',
];

export const inventoryService = {
  async grantDefaultItems(userId: string): Promise<void> {
    await prisma.inventory.createMany({
      data: DEFAULT_FREE_ITEM_IDS.map((itemId) => ({ userId, itemId })),
      skipDuplicates: true,
    });
  },

  async getUserInventory(userId: string) {
    return prisma.inventory.findMany({
      where: { userId },
      include: { item: true },
      orderBy: [{ item: { category: 'asc' } }, { acquiredAt: 'desc' }],
    });
  },

  async hasItem(userId: string, itemId: string): Promise<boolean> {
    const entry = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId, itemId } },
    });
    return !!entry;
  },

  async hasAllItems(userId: string, itemIds: string[]): Promise<boolean> {
    const count = await prisma.inventory.count({
      where: {
        userId,
        itemId: { in: itemIds },
      },
    });
    return count === itemIds.length;
  },
};
