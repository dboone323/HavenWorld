import { prisma } from '../prisma';
import { getFeaturedItems, CATALOG_ITEMS, getEpochRemainingMs } from '@havenworld/shared';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export class ShopService {
  /**
   * Returns current shop state including 3 rotating featured items and all permanent catalog items
   */
  static getShopState() {
    const featured = getFeaturedItems();
    const permanent = CATALOG_ITEMS.filter((item) => !item.featuredPool);
    const epochRemainingMs = getEpochRemainingMs();

    return {
      featured,
      permanent,
      epochRemainingMs,
    };
  }

  /**
   * Process an item purchase using HavenCoins or HavenGems
   */
  static async buyItem(userId: string, itemId: string, currency: 'COIN' | 'GEM' = 'COIN') {
    const itemConfig = CATALOG_ITEMS.find((i) => i.id === itemId);
    if (!itemConfig) {
      throw new Error('Item not found in catalog');
    }

    const price = currency === 'GEM' ? itemConfig.priceGem : itemConfig.priceCoin;
    if (price === undefined || price < 0) {
      throw new Error('Invalid purchase currency for this item');
    }

    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { avatar: true },
      });

      if (!user) throw new Error('User not found');

      if (currency === 'GEM') {
        if (user.havenGems < price) {
          throw new Error('Insufficient HavenGems');
        }
        await tx.user.update({
          where: { id: userId },
          data: { havenGems: { decrement: price } },
        });
      }

      // Ensure item exists in DB items table
      let dbItem = await tx.item.findUnique({ where: { id: itemId } });
      if (!dbItem) {
        dbItem = await tx.item.create({
          data: {
            id: itemId,
            name: itemConfig.name,
            description: itemConfig.description,
            category: itemConfig.category === 'FURNITURE' ? 'FURNITURE' : 'DECORATION',
            rarity: itemConfig.rarity,
            price: itemConfig.priceCoin,
            spriteKey: itemId.replace('furniture-', ''),
            assetUrl: itemConfig.assetUrl,
          },
        });
      }

      // Add to inventory
      const existingInventory = await tx.inventory.findUnique({
        where: { userId_itemId: { userId, itemId: dbItem.id } },
      });

      if (existingInventory) {
        await tx.inventory.update({
          where: { id: existingInventory.id },
          data: { quantity: { increment: 1 } },
        });
      } else {
        await tx.inventory.create({
          data: {
            userId,
            itemId: dbItem.id,
            quantity: 1,
          },
        });
      }

      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, havenGems: true },
      });

      return {
        success: true,
        item: itemConfig,
        user: updatedUser,
      };
    });
  }

  /**
   * Claims the user's daily login streak reward
   */
  static async claimDailyLogin(userId: string) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    return await prisma.$transaction(async (tx) => {
      let streak = await tx.dailyLoginStreak.findUnique({ where: { userId } });

      if (!streak) {
        streak = await tx.dailyLoginStreak.create({
          data: {
            userId,
            currentStreak: 1,
            longestStreak: 1,
            lastLoginDate: now,
          },
        });

        // Award Day 1
        return {
          currentStreak: 1,
          coinsAwarded: 10,
          gemsAwarded: 0,
        };
      }

      const lastLoginStr = streak.lastLoginDate.toISOString().split('T')[0];
      if (lastLoginStr === todayStr) {
        return {
          alreadyClaimed: true,
          currentStreak: streak.currentStreak,
        };
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      let newStreak = 1;
      if (lastLoginStr === yesterdayStr) {
        newStreak = streak.currentStreak + 1;
      }

      let coinsAwarded = 10;
      let gemsAwarded = 0;
      let badge: string | undefined;

      if (newStreak === 3) coinsAwarded = 25;
      else if (newStreak === 7) {
        coinsAwarded = 100;
        gemsAwarded = 1;
      } else if (newStreak === 14) {
        coinsAwarded = 200;
        gemsAwarded = 3;
      } else if (newStreak >= 30) {
        coinsAwarded = 500;
        gemsAwarded = 10;
        badge = 'Loyal Haven';
      }

      await tx.dailyLoginStreak.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          longestStreak: Math.max(streak.longestStreak, newStreak),
          lastLoginDate: now,
        },
      });

      if (gemsAwarded > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { havenGems: { increment: gemsAwarded } },
        });
      }

      return {
        currentStreak: newStreak,
        coinsAwarded,
        gemsAwarded,
        badge,
      };
    });
  }

  /**
   * Gifts an item to another player
   */
  static async giftItem(senderId: string, recipientId: string, itemId: string, message?: string) {
    if (senderId === recipientId) {
      throw new Error('You cannot gift an item to yourself');
    }

    return await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { userId_itemId: { userId: senderId, itemId } },
        include: { item: true },
      });

      if (!inventory || inventory.quantity < 1) {
        throw new Error('You do not own this item to gift');
      }

      if (inventory.quantity === 1) {
        await tx.inventory.delete({ where: { id: inventory.id } });
      } else {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: 1 } },
        });
      }

      // Transfer to recipient
      const recipientInventory = await tx.inventory.findUnique({
        where: { userId_itemId: { userId: recipientId, itemId } },
      });

      if (recipientInventory) {
        await tx.inventory.update({
          where: { id: recipientInventory.id },
          data: { quantity: { increment: 1 } },
        });
      } else {
        await tx.inventory.create({
          data: {
            userId: recipientId,
            itemId,
            quantity: 1,
          },
        });
      }

      // Record transaction
      const giftRecord = await tx.giftTransaction.create({
        data: {
          senderId,
          receiverId: recipientId,
          itemId,
          message: message ? message.slice(0, 140) : null,
        },
        include: { sender: { select: { username: true } } },
      });

      // Emit real-time notification
      const io = getIO();
      if (io) {
        io.to(`user:${recipientId}`).emit(SOCKET_EVENTS.GIFT_RECEIVED, {
          item: inventory.item,
          senderName: giftRecord.sender.username,
          message: giftRecord.message,
        });
      }

      return giftRecord;
    });
  }

  /**
   * Process rotating flash sales or sales events
   */
  static async processFlashSales(): Promise<void> {
    try {
      const io = getIO();
      const featured = getFeaturedItems();
      if (io && featured.length > 0) {
        io.emit(SOCKET_EVENTS.FLASH_SALE_START, {
          featuredItem: featured[0],
          endsInMs: getEpochRemainingMs(),
        });
      }
    } catch (err) {
      console.error('[ShopService] Error processing flash sales:', err);
    }
  }
}

