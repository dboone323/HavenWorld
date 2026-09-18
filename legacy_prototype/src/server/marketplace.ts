/**
 * HavenWorld — Player Marketplace Engine
 *
 * Peer-to-peer asynchronous trading with database escrow, search filtering,
 * offline seller settlement, and a 5% transaction tax sink (2% for Club Haven VIPs).
 */

import * as db from './db.ts';
import type { MarketplaceListing } from '../shared/types.ts';

export class MarketplaceManager {
  async list(
    sellerId: string,
    sellerName: string,
    itemType: string,
    priceCoins: number,
    priceGems: number = 0
  ): Promise<{ success: boolean; listingId?: string; message?: string }> {
    if (priceCoins < 1 && priceGems < 1) {
      return { success: false, message: 'Price must be at least 1 coin or gem' };
    }
    return db.createMarketplaceListing(sellerId, sellerName, itemType, priceCoins, priceGems);
  }

  async browse(query?: string): Promise<MarketplaceListing[]> {
    return db.getMarketplaceListings(query);
  }

  async buy(
    listingId: string,
    buyerId: string,
    buyerCoins: number
  ): Promise<{ success: boolean; itemType?: string; netPaid?: number; sellerId?: string; message?: string }> {
    return db.buyMarketplaceListing(listingId, buyerId, buyerCoins);
  }

  async cancel(
    listingId: string,
    sellerId: string
  ): Promise<{ success: boolean; itemType?: string; message?: string }> {
    return db.cancelMarketplaceListing(listingId, sellerId);
  }
}

export const marketplaceManager = new MarketplaceManager();
