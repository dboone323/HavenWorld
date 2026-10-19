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
        const updateRes = await tx.user.updateMany({
          where: { id: userId, havenGems: { gte: price } },
          data: { havenGems: { decrement: price } },
        });
        if (updateRes.count === 0) {
          throw new Error('Insufficient HavenGems');
        }
      } else {
        const updateRes = await tx.user.updateMany({
          where: { id: userId, havenCoins: { gte: price } },
          data: { havenCoins: { decrement: price } },
        });
        if (updateRes.count === 0) {
          throw new Error('Insufficient HavenCoins');
        }
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

        await tx.user.update({
          where: { id: userId },
          data: { havenCoins: { increment: 10 } },
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

      if (coinsAwarded > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { havenCoins: { increment: coinsAwarded } },
        });
      }

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

      if (!inventory.item.isTradeable) {
        throw new Error('This item is not tradeable and cannot be gifted');
      }

      if (inventory.quantity === 1) {
        const avatar = await tx.avatar.findUnique({ where: { userId: senderId } });
        if (avatar) {
          const equipped = [
            avatar.outfitHead,
            avatar.outfitFace,
            avatar.outfitBody,
            avatar.outfitLegs,
            avatar.outfitFeet,
            avatar.outfitBack,
            avatar.outfitHand,
          ];
          if (equipped.includes(itemId)) {
            throw new Error('Cannot gift an equipped item. Please unequip it first.');
          }
        }
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

  // ─── Batch 49: Dynamic Catalog Rotation, Flash Sales & Stock Quotas ────────

  /**
   * Active flash sales — { itemId → FlashSaleEntry }
   * In-memory; keyed by itemId for O(1) lookup.
   */
  private static flashSales: Map<string, FlashSaleEntry> = new Map();

  /**
   * Stock quota ledger — { itemId → remaining stock count }
   * Once count reaches 0 the item is sold out.
   */
  private static stockQuotas: Map<string, number> = new Map();

  /**
   * Catalog rotation schedule — sorted list of upcoming rotation windows.
   */
  private static rotationSchedule: CatalogRotationWindow[] = [];

  /**
   * Schedules a flash sale for an item with a discount % and duration.
   * A sale cannot be set below 5% or above 90% discount.
   */
  static scheduleFlashSale(
    itemId: string,
    discountPercent: number,
    durationMs: number,
  ): FlashSaleEntry {
    if (discountPercent < 5 || discountPercent > 90) {
      throw new Error('INVALID_DISCOUNT_RANGE');
    }
    const entry: FlashSaleEntry = {
      itemId,
      discountPercent,
      startsAt: Date.now(),
      endsAt: Date.now() + durationMs,
      active: true,
    };
    ShopService.flashSales.set(itemId, entry);
    return entry;
  }

  /**
   * Returns the effective price for an item after applying any active flash sale.
   * If no sale is active for the item, returns the base coin price.
   */
  static getEffectivePrice(itemId: string, now = Date.now()): { price: number; onSale: boolean; discountPercent: number } {
    const item = CATALOG_ITEMS.find((i) => i.id === itemId);
    if (!item) throw new Error('ITEM_NOT_FOUND');

    const sale = ShopService.flashSales.get(itemId);
    if (sale && sale.active && now >= sale.startsAt && now <= sale.endsAt) {
      const discounted = Math.floor((item.priceCoin ?? 0) * (1 - sale.discountPercent / 100));
      return { price: discounted, onSale: true, discountPercent: sale.discountPercent };
    }

    return { price: item.priceCoin ?? 0, onSale: false, discountPercent: 0 };
  }

  /**
   * Expires flash sales whose `endsAt` has passed.
   * Returns the list of itemIds whose sales were expired.
   */
  static expireFlashSales(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const [itemId, sale] of ShopService.flashSales) {
      if (sale.active && now > sale.endsAt) {
        sale.active = false;
        expired.push(itemId);
      }
    }
    return expired;
  }

  /**
   * Sets a stock quota for a limited-edition item.
   * Throws if quota is <= 0.
   */
  static setStockQuota(itemId: string, stock: number): void {
    if (stock <= 0) throw new Error('INVALID_STOCK_QUOTA');
    ShopService.stockQuotas.set(itemId, stock);
  }

  /**
   * Decrements stock for an item and returns the remaining count.
   * Throws SOLD_OUT when stock reaches 0.
   */
  static consumeStock(itemId: string, qty = 1): number {
    const current = ShopService.stockQuotas.get(itemId);
    if (current === undefined) return Infinity; // unlimited stock
    if (current < qty) throw new Error('SOLD_OUT');
    const remaining = current - qty;
    ShopService.stockQuotas.set(itemId, remaining);
    return remaining;
  }

  /**
   * Returns current stock for an item, or null if unlimited.
   */
  static getStock(itemId: string): number | null {
    return ShopService.stockQuotas.has(itemId)
      ? (ShopService.stockQuotas.get(itemId) ?? 0)
      : null;
  }

  /**
   * Pushes a catalog rotation window into the schedule (chronological order).
   */
  static addRotationWindow(window: CatalogRotationWindow): void {
    ShopService.rotationSchedule.push(window);
    ShopService.rotationSchedule.sort((a, b) => a.startsAt - b.startsAt);
  }

  /**
   * Returns the active rotation window for the given timestamp, or null if none.
   */
  static getActiveRotation(now = Date.now()): CatalogRotationWindow | null {
    return (
      ShopService.rotationSchedule.find((w) => now >= w.startsAt && now <= w.endsAt) ?? null
    );
  }

  /**
   * Returns all upcoming (not-yet-started) rotation windows.
   */
  static getUpcomingRotations(now = Date.now()): CatalogRotationWindow[] {
    return ShopService.rotationSchedule.filter((w) => w.startsAt > now);
  }
}

export interface FlashSaleEntry {
  itemId: string;
  discountPercent: number;
  startsAt: number;
  endsAt: number;
  active: boolean;
}

export interface CatalogRotationWindow {
  windowId: string;
  label: string;
  featuredItemIds: string[];
  startsAt: number;
  endsAt: number;
}


