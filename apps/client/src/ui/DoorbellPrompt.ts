import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { SceneManager } from '../engine/SceneManager';
import { showToast } from './ToastNotification';

interface DoorbellResult {
  admitted: boolean;
  roomId: string;
  message: string;
}

/**
 * Visitor-side doorbell prompt (roadmap §3f). Shown when AUTH_JOIN is
 * rejected with FORBIDDEN_PRIVATE_LOFT; ringing sends RING_DOORBELL and the
 * owner's accept/decline arrives back on DOORBELL_RESULT.
 */
export class DoorbellPrompt {
  private static overlay: HTMLElement | null = null;
  private static unsub: (() => void) | null = null;

  static show(roomId: string): void {
    this.dismiss();

    const overlay = document.createElement('div');
    overlay.id = 'doorbell-prompt-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 10002; font-family: inherit;
    `;

    overlay.innerHTML = `
      <div style="
        background:#1b1b36;border:1px solid rgba(255,255,255,0.2);border-radius:16px;
        color:#fff;padding:26px;width:min(380px, calc(100vw - 32px));text-align:center;
        box-shadow:0 12px 48px rgba(0,0,0,0.6);
      ">
        <div style="font-size:44px">🚪</div>
        <h2 style="margin:8px 0 6px;font-size:17px">This loft is private</h2>
        <p id="doorbell-note" style="margin:0 0 16px;font-size:13px;opacity:0.8">Ring the doorbell and ask the resident to let you in.</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button data-action="ring" style="padding:9px 18px;border-radius:9px;border:none;background:#4ecdc4;color:#12122b;font-weight:600;cursor:pointer;font-family:inherit">🔔 Ring Doorbell</button>
          <button data-action="leave" style="padding:9px 18px;border-radius:9px;border:1px solid rgba(255,255,255,0.3);background:none;color:#fff;cursor:pointer;font-family:inherit">Back to Lobby</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('[data-action="leave"]')?.addEventListener('click', () => {
      this.dismiss();
      SceneManager.getInstance().switchTo('lobby').catch(console.error);
    });

    overlay.querySelector('[data-action="ring"]')?.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.RING_DOORBELL, { roomId });
      const note = overlay.querySelector('#doorbell-note');
      if (note) note.textContent = 'Ding-dong! Waiting for the resident to answer…';
      overlay.querySelector('[data-action="ring"]')?.setAttribute('disabled', 'disabled');

      this.unsub = socketService.on<DoorbellResult>(SOCKET_EVENTS.DOORBELL_RESULT, (result) => {
        if (result.roomId !== roomId) return;
        this.dismiss();
        if (result.admitted) {
          showToast({ icon: '🎉', title: 'Welcome in!', subtitle: result.message });
          SceneManager.getInstance().switchTo('room', { roomId }).catch(console.error);
        } else {
          showToast({ icon: '😴', title: 'No answer', subtitle: result.message });
          SceneManager.getInstance().switchTo('lobby').catch(console.error);
        }
      });
    });

    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
  }

  static dismiss(): void {
    this.unsub?.();
    this.unsub = null;
    this.overlay?.remove();
    this.overlay = null;
  }
}
