import { WorkshopService } from './WorkshopService';
import { AnalyticsService } from './AnalyticsService';

/**
 * Alias facade over WorkshopService for Workshop Crafting.
 * WorkshopService.claimCraft already emits AnalyticsService.trackEvent('CRAFT_ITEM').
 */
export class CraftingService extends WorkshopService {
  static async trackCraftItem(userId: string, payload?: Record<string, unknown>) {
    await AnalyticsService.trackEvent('CRAFT_ITEM', { userId, payload });
  }
}
