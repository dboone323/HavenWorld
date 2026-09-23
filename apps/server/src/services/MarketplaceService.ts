import { prisma } from '../prisma';
import { captureSecurityEvent } from '../monitoring/sentry';

export const MARKETPLACE_TAX_RATE = 0.05; // 5% transaction tax (economic sink)

export interface MarketplaceFilter {
  itemId?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}

export class MarketplaceService {
  /**
   * List an item for sale on the player marketplace.
   * Transfers item from player inventory into marketplace escrow.
   */
  static async listItem(sellerId: string, itemId: string, priceCoins: number) {
    if (!Number.isInteger(priceCoins) || priceCoins <= 0) {
      throw new Error('INVALID_PRICE: Listing price must be a positive integer.');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Verify seller owns the item
      const inventory = await tx.inventory.findUnique({
        where: {
          userId_itemId: {
            userId: sellerId,
            itemId,
          },
        },
      });

      if (!inventory || inventory.quantity <= 0) {
        throw new Error('ITEM_NOT_OWNED: You do not own this item.');
      }

      // 2. Escrow: Deduct 1 from inventory or delete row if last item
      if (inventory.quantity > 1) {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: 1 } },
        });
      } else {
        await tx.inventory.delete({
          where: { id: inventory.id },
        });
      }

      // 3. Create active marketplace listing
      const listing = await tx.marketplaceListing.create({
        data: {
          sellerId,
          itemId,
          priceCoins,
          status: 'ACTIVE',
        },
        include: {
          item: true,
          seller: { select: { id: true, username: true } },
        },
      });

      return listing;
    });
  }

  /**
   * Cancel an active listing and return the escrowed item to seller inventory.
   */
  static async cancelListing(sellerId: string, listingId: string) {
    return await prisma.$transaction(async (tx) => {
      const listing = await tx.marketplaceListing.findUnique({
        where: { id: listingId },
      });

      if (!listing) {
        throw new Error('LISTING_NOT_FOUND: Listing does not exist.');
      }

      if (listing.sellerId !== sellerId) {
        throw new Error('UNAUTHORIZED: You can only cancel your own listings.');
      }

      if (listing.status !== 'ACTIVE') {
        throw new Error('INVALID_STATE: Listing is no longer active.');
      }

      // 1. Mark listing cancelled
      await tx.marketplaceListing.update({
        where: { id: listingId },
        data: { status: 'CANCELLED' },
      });

      // 2. Return item to inventory
      await tx.inventory.upsert({
        where: {
          userId_itemId: {
            userId: sellerId,
            itemId: listing.itemId,
          },
        },
        update: { quantity: { increment: 1 } },
        create: {
          userId: sellerId,
          itemId: listing.itemId,
          quantity: 1,
        },
      });

      return { success: true, listingId };
    });
  }

  /**
   * Purchase a listing atomically:
   * 1. Buyer pays price in HavenCoins
   * 2. 5% tax sink deducted
   * 3. Seller receives net coins
   * 4. Buyer receives item in inventory
   * 5. Listing marked SOLD
   */
  static async buyListing(buyerId: string, listingId: string) {
    return await prisma.$transaction(async (tx) => {
      const listing = await tx.marketplaceListing.findUnique({
        where: { id: listingId },
        include: { item: true },
      });

      if (!listing) {
        throw new Error('LISTING_NOT_FOUND: Listing does not exist.');
      }

      if (listing.status !== 'ACTIVE') {
        throw new Error('LISTING_UNAVAILABLE: Item has already been sold or cancelled.');
      }

      if (listing.sellerId === buyerId) {
        throw new Error('CANNOT_BUY_OWN: You cannot purchase your own listing.');
      }

      const buyer = await tx.user.findUnique({
        where: { id: buyerId },
        select: { id: true, havenCoins: true, isBanned: true },
      });

      if (!buyer || buyer.isBanned) {
        throw new Error('BUYER_UNAVAILABLE: Account is invalid or suspended.');
      }

      if (buyer.havenCoins < listing.priceCoins) {
        throw new Error('INSUFFICIENT_FUNDS: Not enough HavenCoins for this purchase.');
      }

      // Calculate economic tax sink (5%)
      const tax = Math.floor(listing.priceCoins * MARKETPLACE_TAX_RATE);
      const sellerPayout = listing.priceCoins - tax;

      // 1. Deduct full price from buyer
      const updatedBuyer = await tx.user.update({
        where: { id: buyerId },
        data: { havenCoins: { decrement: listing.priceCoins } },
        select: { havenCoins: true },
      });

      // 2. Credit net payout to seller
      const updatedSeller = await tx.user.update({
        where: { id: listing.sellerId },
        data: { havenCoins: { increment: sellerPayout } },
        select: { havenCoins: true },
      });

      // 3. Grant item to buyer inventory
      await tx.inventory.upsert({
        where: {
          userId_itemId: {
            userId: buyerId,
            itemId: listing.itemId,
          },
        },
        update: { quantity: { increment: 1 } },
        create: {
          userId: buyerId,
          itemId: listing.itemId,
          quantity: 1,
        },
      });

      // 4. Mark listing SOLD
      const updatedListing = await tx.marketplaceListing.update({
        where: { id: listingId },
        data: {
          status: 'SOLD',
          buyerId,
          purchasedAt: new Date(),
        },
      });

      // 5. Log transactions for auditing & telemetry
      await tx.transactionLog.create({
        data: {
          senderId: buyerId,
          receiverId: listing.sellerId,
          amount: listing.priceCoins,
          type: 'TRANSFER',
          source: `MARKETPLACE_PURCHASE:${listingId}:TAX_${tax}`,
        },
      });

      return {
        success: true,
        listing: updatedListing,
        pricePaid: listing.priceCoins,
        taxSink: tax,
        sellerPayout,
        buyerBalance: updatedBuyer.havenCoins,
        sellerBalance: updatedSeller.havenCoins,
      };
    });
  }

  /**
   * Search active listings with filtering and pagination.
   */
  static async getActiveListings(filter: MarketplaceFilter = {}) {
    const { itemId, minPrice, maxPrice, limit = 50, offset = 0 } = filter;

    const where: any = { status: 'ACTIVE' };
    if (itemId) where.itemId = itemId;
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.priceCoins = {};
      if (minPrice !== undefined) where.priceCoins.gte = minPrice;
      if (maxPrice !== undefined) where.priceCoins.lte = maxPrice;
    }

    const [total, listings] = await Promise.all([
      prisma.marketplaceListing.count({ where }),
      prisma.marketplaceListing.findMany({
        where,
        include: {
          item: true,
          seller: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(100, limit),
        skip: offset,
      }),
    ]);

    return { total, listings };
  }
}
