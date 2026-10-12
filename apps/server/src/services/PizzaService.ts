import { MinigameService } from './MinigameService';
import { AnalyticsService } from './AnalyticsService';

/**
 * Alias facade over MinigameService for Pizza Chef orders.
 * MinigameService.submitPizzaOrder already emits AnalyticsService.trackEvent('PIZZA_ORDER_SUBMIT').
 */
export class PizzaService extends MinigameService {
  static async trackPizzaOrderSubmit(userId: string, payload?: Record<string, unknown>) {
    await AnalyticsService.trackEvent('PIZZA_ORDER_SUBMIT', { userId, payload });
  }
}
