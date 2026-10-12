export interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  isOnline: boolean;
  registration: ServiceWorkerRegistration | null;
}

export type ConnectionChangeCallback = (isOnline: boolean) => void;

/**
 * Service Worker & Offline PWA Manager for HavenWorld
 */
export class ServiceWorkerManager {
  private static registration: ServiceWorkerRegistration | null = null;
  private static listeners: Set<ConnectionChangeCallback> = new Set();
  private static onlineStatus: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private static listenersAttached: boolean = false;

  private static ensureListenersAttached() {
    if (!this.listenersAttached && typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      this.listenersAttached = true;
    }
  }

  /**
   * Initializes network listeners and registers service worker in supported browser environments
   */
  static async register(swUrl: string = '/sw.js'): Promise<ServiceWorkerRegistration | null> {
    this.ensureListenersAttached();

    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    try {
      const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
      this.registration = reg;

      // Listen for updates
      reg.addEventListener('updatefound', () => {
        const installingWorker = reg.installing;
        if (installingWorker) {
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('havenworld:sw_updated'));
            }
          });
        }
      });

      return reg;
    } catch (err) {
      console.warn('[ServiceWorkerManager] Registration failed:', err);
      return null;
    }
  }

  static isOnline(): boolean {
    return this.onlineStatus;
  }

  /**
   * Subscribes to network connectivity changes
   */
  static onConnectionChange(callback: ConnectionChangeCallback): () => void {
    this.ensureListenersAttached();
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private static handleOnline = () => {
    this.onlineStatus = true;
    this.notifyListeners(true);
  };

  private static handleOffline = () => {
    this.onlineStatus = false;
    this.notifyListeners(false);
  };

  private static notifyListeners(isOnline: boolean) {
    for (const listener of this.listeners) {
      try {
        listener(isOnline);
      } catch (err) {
        console.error('[ServiceWorkerManager] Listener error:', err);
      }
    }
  }

  /**
   * Sends SKIP_WAITING to activate an idle waiting service worker
   */
  static async skipWaiting(): Promise<void> {
    if (this.registration?.waiting) {
      this.registration.waiting.postMessage('SKIP_WAITING');
    } else if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
    }
  }

  /**
   * Requests the service worker to clear outdated caches
   */
  static async clearOutdatedCaches(): Promise<void> {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('CLEAR_OUTDATED_CACHES');
    }
  }

  /**
   * Requests invalidation of cached runtime assets
   */
  static async invalidateAssetCache(): Promise<void> {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage('INVALIDATE_ASSETS');
    }
  }

  /**
   * Manually checks for service worker updates
   */
  static async checkForUpdates(): Promise<boolean> {
    if (!this.registration) return false;
    try {
      await this.registration.update();
      return !!this.registration.waiting;
    } catch {
      return false;
    }
  }

  /**
   * Unregisters all service workers (used during dev reset or test cleanup)
   */
  static async unregister(): Promise<boolean> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      this.listenersAttached = false;
    }
    this.listeners.clear();

    if (this.registration) {
      const result = await this.registration.unregister();
      this.registration = null;
      return result;
    }
    return false;
  }
}
