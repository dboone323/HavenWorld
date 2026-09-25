import { prisma } from '../prisma';
import { ItemNotFoundError, InsufficientFundsError } from '../errors';

export interface TransferCoinsOptions {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export const DEFAULT_FREE_ITEM_IDS = [
  // MiPlanet Authentic Wearables
  'pink-llama-sweater',
  'olive-shorts',
  'denim-jeans',
  'basic-blue-eyes',
  'basic-brown-eyes',
  'trapper-hat',
  'skull-balaclava',
  'purple-sneakers',
  'wavy-hair',
  'white-wings',
  'black-wings',
  // Legacy Starters
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

export class InventoryService {
  private client: typeof prisma;

  constructor(client = prisma) {
    this.client = client;
  }

  /**
   * Grants default starter items to a newly registered user
   */
  async grantDefaultItems(userId: string): Promise<void> {
    const validItems = await this.client.item.findMany({
      where: { id: { in: DEFAULT_FREE_ITEM_IDS } },
      select: { id: true },
    });
    if (validItems.length === 0) return;

    await this.client.inventory.createMany({
      data: validItems.map((item) => ({ userId, itemId: item.id })),
      skipDuplicates: true,
    });
  }

  /**
   * Retrieves all inventory items owned by a user
   */
  async getUserInventory(userId: string) {
    return this.client.inventory.findMany({
      where: { userId },
      include: { item: true },
      orderBy: [{ item: { category: 'asc' } }, { acquiredAt: 'desc' }],
    });
  }

  /**
   * Checks whether a user owns a specific item
   */
  async hasItem(userId: string, itemId: string): Promise<boolean> {
    const entry = await this.client.inventory.findUnique({
      where: { userId_itemId: { userId, itemId } },
    });
    return !!entry;
  }

  /**
   * Checks whether a user owns all items in a specified list
   */
  async hasAllItems(userId: string, itemIds: string[]): Promise<boolean> {
    const count = await this.client.inventory.count({
      where: {
        userId,
        itemId: { in: itemIds },
      },
    });
    return count === itemIds.length;
  }

  /**
   * Adds an item to a user's inventory
   */
  async addItem(userId: string, itemId: string, quantity = 1) {
    const existing = await this.client.inventory.findUnique({
      where: { userId_itemId: { userId, itemId } },
    });

    if (existing) {
      return await this.client.inventory.update({
        where: { id: existing.id },
        data: { quantity: { increment: quantity } },
      });
    }

    return await this.client.inventory.create({
      data: {
        userId,
        itemId,
        quantity,
      },
    });
  }

  /**
   * Removes an item from a user's inventory
   */
  async removeItem(userId: string, itemId: string, quantity = 1) {
    const existing = await this.client.inventory.findUnique({
      where: { userId_itemId: { userId, itemId } },
    });

    if (!existing || existing.quantity < quantity) {
      throw new ItemNotFoundError(`Item ${itemId} not found in inventory or insufficient quantity`);
    }

    if (existing.quantity === quantity) {
      return await this.client.inventory.delete({
        where: { id: existing.id },
      });
    }

    return await this.client.inventory.update({
      where: { id: existing.id },
      data: { quantity: { decrement: quantity } },
    });
  }

  /**
   * Transfers HavenCoins atomically between two players
   */
  async transferCoins(opts: TransferCoinsOptions) {
    if (opts.amount <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    if (opts.fromUserId === opts.toUserId) {
      throw new Error('SELF_TRANSFER');
    }

    return await this.client.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({
        where: { id: opts.fromUserId },
        select: { id: true, havenCoins: true },
      });

      if (!sender || sender.havenCoins < opts.amount) {
        throw new InsufficientFundsError('Sender has insufficient HavenCoins');
      }

      await tx.user.update({
        where: { id: opts.fromUserId },
        data: { havenCoins: { decrement: opts.amount } },
      });

      await tx.user.update({
        where: { id: opts.toUserId },
        data: { havenCoins: { increment: opts.amount } },
      });

      return { success: true, amountTransferred: opts.amount };
    });
  }

  /**
   * Awards coins respecting weekly earnings cap
   */
  async earnCoins(userId: string, attemptedAmount: number, maxCap = 2000) {
    if (attemptedAmount <= 0) return { coinsAwarded: 0, cappedAt: maxCap };

    return await this.client.$transaction(async (tx) => {
      // Find or create weekly cap
      const now = new Date();
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      startOfWeek.setHours(0, 0, 0, 0);

      const capRecord = await tx.weeklyEarningsCap.findUnique({
        where: { userId_gameType_weekOf: { userId, gameType: 'global', weekOf: startOfWeek } },
      });

      const currentEarned = capRecord?.earned ?? 0;
      const remainingCap = Math.max(0, maxCap - currentEarned);
      const coinsAwarded = Math.min(attemptedAmount, remainingCap);

      if (coinsAwarded > 0) {
        await tx.weeklyEarningsCap.upsert({
          where: { userId_gameType_weekOf: { userId, gameType: 'global', weekOf: startOfWeek } },
          create: {
            userId,
            gameType: 'global',
            weekOf: startOfWeek,
            earned: coinsAwarded,
          },
          update: {
            earned: { increment: coinsAwarded },
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { havenCoins: { increment: coinsAwarded } },
        });
      }

      return {
        coinsAwarded,
        cappedAt: maxCap,
        remainingCap: remainingCap - coinsAwarded,
      };
    });
  }

  /**
   * Claims daily login bonus with calendar day duplicate protection
   */
  async claimDailyLoginBonus(userId: string) {
    const todayStr = new Date().toISOString().split('T')[0];

    return await this.client.$transaction(async (tx) => {
      const streak = await tx.dailyLoginStreak.findUnique({ where: { userId } });

      if (streak) {
        const lastClaimStr = streak.lastLoginDate.toISOString().split('T')[0];
        if (lastClaimStr === todayStr) {
          throw new Error('ALREADY_CLAIMED_TODAY');
        }
      }

      const newStreak = (streak?.currentStreak ?? 0) + 1;
      const coinsAwarded = 100;

      await tx.dailyLoginStreak.upsert({
        where: { userId },
        create: {
          userId,
          currentStreak: 1,
          longestStreak: 1,
          lastLoginDate: new Date(),
        },
        update: {
          currentStreak: newStreak,
          longestStreak: Math.max(streak?.longestStreak ?? 0, newStreak),
          lastLoginDate: new Date(),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { havenCoins: { increment: coinsAwarded } },
      });

      return { success: true, coinsAwarded, currentStreak: newStreak };
    });
  }
}

export const inventoryService = new InventoryService();
