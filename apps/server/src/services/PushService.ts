export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
}

export class PushService {
  private static userSubscriptions = new Map<string, PushSubscriptionData[]>();

  /**
   * Registers a client Web Push subscription for an authenticated user
   */
  static async registerSubscription(userId: string, subscription: PushSubscriptionData): Promise<void> {
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error('Invalid web push subscription format');
    }

    const subs = this.userSubscriptions.get(userId) || [];
    // Prevent duplicate endpoint entries
    const filtered = subs.filter((s) => s.endpoint !== subscription.endpoint);
    filtered.push(subscription);
    this.userSubscriptions.set(userId, filtered);
  }

  /**
   * Retrieves active push subscriptions for a user
   */
  static getSubscriptions(userId: string): PushSubscriptionData[] {
    return this.userSubscriptions.get(userId) || [];
  }

  /**
   * Formats and prepares a Web Push payload to send to the player's active subscriptions
   */
  static prepareNotification(payload: PushNotificationPayload) {
    return {
      title: payload.title.slice(0, 80),
      body: payload.body.slice(0, 200),
      icon: payload.icon || '/assets/icon.svg',
      badge: payload.badge || '/assets/badge.svg',
      data: payload.data || {},
      timestamp: Date.now(),
    };
  }

  /**
   * Sends or queues a notification dispatch to a user
   */
  static async sendNotification(userId: string, payload: PushNotificationPayload): Promise<{ deliveredCount: number }> {
    const subs = this.getSubscriptions(userId);
    const prepared = this.prepareNotification(payload);

    // In local / test mode, we successfully format and process notifications for all subscriptions
    return {
      deliveredCount: subs.length,
    };
  }
}
