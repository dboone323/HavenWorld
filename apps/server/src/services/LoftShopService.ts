import { prisma } from '../prisma';

export interface LoftShopListing {
  id: string;
  roomId: string;
  sellerId: string;
  itemId: string;
  priceCoins: number;
  available: boolean;
}

export class LoftShopService {
  private static listings = new Map<string, LoftShopListing>();

  /** All active register listings for a room (for guests who arrive later). */
  static getListingsForRoom(roomId: string): LoftShopListing[] {
    return Array.from(this.listings.values()).filter((l) => l.roomId === roomId);
  }

  /**
   * Stocks a cash register item in a personal loft for sale to visiting guests
   */
  static async stockRegister(ownerId: string, roomId: string, itemId: string, priceCoins: number) {
    if (!Number.isInteger(priceCoins) || priceCoins <= 0) {
      throw new Error('Price must be a positive integer');
    }

    // Verify owner owns the item and it is tradeable
    const inventory = await prisma.inventory.findFirst({
      where: { userId: ownerId, itemId, quantity: { gte: 1 } },
      include: { item: true },
    });

    if (!inventory) {
      throw new Error('You do not own this item in your inventory');
    }

    if (!inventory.item.isTradeable) {
      throw new Error('This item is not tradeable and cannot be stocked');
    }

    if (inventory.quantity === 1) {
      const avatar = await prisma.avatar.findUnique({ where: { userId: ownerId } });
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
          throw new Error('Cannot stock an equipped item. Please unequip it first.');
        }
      }
    }

    // Verify owner owns the room
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== ownerId) {
      throw new Error('Only the loft owner can stock this shop register');
    }

    const listingId = `loft_shop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const listing: LoftShopListing = {
      id: listingId,
      roomId,
      sellerId: ownerId,
      itemId,
      priceCoins,
      available: true,
    };

    this.listings.set(listingId, listing);
    return listing;
  }

  /**
   * Purchases an item stocked in a player's loft register
   */
  static async purchaseFromRegister(buyerId: string, listingId: string) {
    const listing = this.listings.get(listingId);
    if (!listing || !listing.available) {
      throw new Error('Listing is no longer available');
    }

    if (buyerId === listing.sellerId) {
      throw new Error('Cannot purchase your own listed item');
    }

    // Claim listing synchronously before async DB transaction to prevent concurrent TOCTOU double-purchase
    listing.available = false;

    try {
      return await prisma.$transaction(async (tx) => {
        const buyer = await tx.user.findUnique({
          where: { id: buyerId },
          select: { havenCoins: true },
        });

        if (!buyer || buyer.havenCoins < listing.priceCoins) {
          throw new Error('Insufficient HavenCoins to complete purchase');
        }

        const sellerInventory = await tx.inventory.findFirst({
          where: { userId: listing.sellerId, itemId: listing.itemId, quantity: { gte: 1 } },
          include: { item: true },
        });

        if (!sellerInventory || !sellerInventory.item.isTradeable) {
          throw new Error('Seller no longer has this item in stock');
        }

        // Deduct coins from buyer
        await tx.user.update({
          where: { id: buyerId },
          data: { havenCoins: { decrement: listing.priceCoins } },
        });

        // Credit coins to seller
        await tx.user.update({
          where: { id: listing.sellerId },
          data: { havenCoins: { increment: listing.priceCoins } },
        });

        // Decrement seller inventory
        if (sellerInventory.quantity === 1) {
          await tx.inventory.delete({ where: { id: sellerInventory.id } });
        } else {
          await tx.inventory.update({
            where: { id: sellerInventory.id },
            data: { quantity: { decrement: 1 } },
          });
        }

        // Increment/create buyer inventory
        await tx.inventory.upsert({
          where: { userId_itemId: { userId: buyerId, itemId: listing.itemId } },
          create: { userId: buyerId, itemId: listing.itemId, quantity: 1 },
          update: { quantity: { increment: 1 } },
        });

        return {
          success: true,
          itemId: listing.itemId,
          priceCoins: listing.priceCoins,
          sellerId: listing.sellerId,
          buyerId,
        };
      });
    } catch (err: any) {
      // Restore availability if buyer lacked funds (keep false if seller lacked stock)
      if (err?.message === 'Insufficient HavenCoins to complete purchase') {
        listing.available = true;
      }
      throw err;
    }
  }
}
