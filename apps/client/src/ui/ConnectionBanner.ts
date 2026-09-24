import type { SocketConnectionStatus, SocketStatusDetail } from '../services/socket';
import { socketService } from '../services/socket';

/**
 * ConnectionBanner — a small top-center banner that appears while the socket
 * is reconnecting (showing the current attempt count) or after reconnect
 * attempts are exhausted (with a manual "Reconnect now" button).
 *
 * Previously, a dropped socket retried silently in the background: the player
 * saw a frozen world with no explanation and no way to force a retry.
 *
 * Driven by the `socket:status` window event emitted from services/socket.ts.
 * Styled after the PWA install banner (InstallPrompt.ts).
 */
export class ConnectionBanner {
  private banner: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private reconnectBtn: HTMLButtonElement | null = null;

  constructor() {
    window.addEventListener('socket:status', (e) => {
      const detail = (e as CustomEvent<SocketStatusDetail>).detail;
      this.onStatus(detail.status, detail.attempt);
    });
    // If the banner mounts while a status is already active (e.g. after a
    // hot reload), reflect it immediately instead of waiting for the next event.
    const current = socketService.status;
    if (current.status === 'reconnecting' || current.status === 'reconnect_failed') {
      this.onStatus(current.status, current.attempt);
    }
  }

  private onStatus(status: SocketConnectionStatus, attempt: number): void {
    if (status === 'reconnecting' || status === 'reconnect_failed') {
      this.show(status, attempt);
    } else {
      this.hide();
    }
  }

  private show(status: 'reconnecting' | 'reconnect_failed', attempt: number): void {
    if (!this.banner) this.build();
    if (!this.banner || !this.statusEl || !this.reconnectBtn) return;

    if (status === 'reconnecting') {
      this.statusEl.textContent = `Connection lost — reconnecting… (attempt ${attempt})`;
      this.reconnectBtn.style.display = 'none';
      this.banner.style.borderColor = 'rgba(255, 193, 7, 0.55)';
    } else {
      this.statusEl.textContent = "Couldn't reconnect to HavenWorld. Check your connection.";
      this.reconnectBtn.style.display = 'inline-block';
      this.banner.style.borderColor = 'rgba(255, 107, 107, 0.65)';
    }
    // Inline style (not the `.hidden` class): this banner sets display:flex
    // inline, which would override the stylesheet's `.hidden`.
    this.banner.style.display = 'flex';
  }

  private hide(): void {
    if (this.banner) this.banner.style.display = 'none';
  }

  private build(): void {
    const banner = document.createElement('div');
    banner.setAttribute('data-testid', 'connection-banner');
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
      'position: fixed',
      'top: 14px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 9000',
      'display: none',
      'align-items: center',
      'gap: 12px',
      'padding: 10px 18px',
      'background: rgba(26, 26, 46, 0.95)',
      'border: 1px solid rgba(78, 205, 196, 0.4)',
      'border-radius: 999px',
      'box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5)',
      'color: #e8e8f0',
      "font-family: 'Segoe UI', system-ui, -apple-system, sans-serif",
      'font-size: 14px',
      'backdrop-filter: blur(8px)',
    ].join(';');

    const dot = document.createElement('span');
    dot.textContent = '🔄';
    dot.style.fontSize = '16px';

    const statusEl = document.createElement('span');

    const reconnectBtn = document.createElement('button');
    reconnectBtn.setAttribute('data-testid', 'connection-reconnect-btn');
    reconnectBtn.textContent = 'Reconnect now';
    reconnectBtn.style.cssText = [
      'display: none',
      'padding: 6px 14px',
      'border: none',
      'border-radius: 999px',
      'background: linear-gradient(135deg, #4ecdc4, #44a08d)',
      'color: #0d0d1a',
      'font-weight: 700',
      'font-size: 13px',
      'cursor: pointer',
    ].join(';');
    reconnectBtn.addEventListener('click', () => {
      socketService.reconnectNow();
    });

    banner.append(dot, statusEl, reconnectBtn);
    document.body.append(banner);

    this.banner = banner;
    this.statusEl = statusEl;
    this.reconnectBtn = reconnectBtn;
  }
}
