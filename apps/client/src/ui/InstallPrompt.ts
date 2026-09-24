/**
 * PWA install prompt + service-worker registration (Part 9A §2.6).
 *
 * Registers `/sw.js`, surfaces a dismissible "Install HavenWorld" banner when the
 * browser fires `beforeinstallprompt`, and remembers dismissal for 14 days so the
 * banner never nags. All failures are non-fatal: the game runs fine without PWA.
 */

const DISMISS_KEY = 'havenworld:install-dismissed-at';
const DISMISS_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export class InstallPrompt {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private banner: HTMLElement | null = null;

  constructor() {
    void this.registerServiceWorker();

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      if (this.wasRecentlyDismissed()) return;
      this.showBanner();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.hideBanner();
    });
  }

  private wasRecentlyDismissed(): boolean {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      const elapsed = Date.now() - Number(raw);
      return elapsed < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  private rememberDismissal(): void {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable (private mode) — banner simply reappears next visit */
    }
  }

  private async registerServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      // The installing worker is the one that must receive SKIP_WAITING. Looking
      // at registration.waiting from inside its own statechange callback is racy
      // and can leave an installed PWA controlled by the previous deploy.
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            installingWorker.postMessage('SKIP_WAITING');
          }
        });
      });
    } catch (err) {
      console.warn('[PWA] Service worker registration failed:', err);
    }
  }

  private showBanner(): void {
    if (this.banner || document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install HavenWorld');
    banner.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      z-index: 120;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(20, 20, 35, 0.97);
      border: 1px solid #4ecdc4;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
      color: #e2e8f0;
      font-size: 10.5pt;
      max-width: min(92vw, 420px);
    `;

    const text = document.createElement('span');
    text.textContent = 'Install HavenWorld for a full-screen, faster world.';

    const installBtn = document.createElement('button');
    installBtn.id = 'pwa-install-accept';
    installBtn.textContent = 'Install';
    installBtn.style.cssText =
      'background: #4ecdc4; color: #0d0d1a; border: none; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer;';
    installBtn.addEventListener('click', () => void this.accept());

    const dismissBtn = document.createElement('button');
    dismissBtn.id = 'pwa-install-dismiss';
    dismissBtn.textContent = 'Not now';
    dismissBtn.style.cssText =
      'background: transparent; color: #9aa5b1; border: none; padding: 8px 6px; cursor: pointer;';
    dismissBtn.addEventListener('click', () => {
      this.rememberDismissal();
      this.hideBanner();
    });

    banner.appendChild(text);
    banner.appendChild(installBtn);
    banner.appendChild(dismissBtn);
    document.body.appendChild(banner);
    this.banner = banner;
  }

  private async accept(): Promise<void> {
    if (!this.deferredPrompt) return;
    try {
      await this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      if (outcome === 'dismissed') this.rememberDismissal();
    } catch (err) {
      console.warn('[PWA] Install prompt failed:', err);
    } finally {
      this.deferredPrompt = null;
      this.hideBanner();
    }
  }

  hideBanner(): void {
    this.banner?.remove();
    this.banner = null;
  }
}

/** Convenience bootstrap used by main.ts. */
export function initPwa(): InstallPrompt {
  return new InstallPrompt();
}