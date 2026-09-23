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

  /**
   * Stocks a cash register item in a personal loft for sale to visiting guests
   */
  static async stockRegister(ownerId: string, roomId: string, itemId: string, priceCoins: number) {
    if (!Number.isInteger(priceCoins) || priceCoins <= 0) {
      throw new Error('Price must be a positive integer');
    }

    // Verify owner owns the item
    const inventory = await prisma.inventory.findFirst({
      where: { userId: ownerId, itemId, quantity: { gte: 1 } },
    });

    if (!inventory) {
      throw new Error('You do not own this item in your inventory');
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
      });

      if (!sellerInventory) {
        listing.available = false;
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

      // Mark listing fulfilled
      listing.available = false;

      return {
        success: true,
        itemId: listing.itemId,
        priceCoins: listing.priceCoins,
        sellerId: listing.sellerId,
        buyerId,
      };
    });
  }
}
