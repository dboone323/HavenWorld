import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

/**
 * Bug / feature feedback pane (roadmap §3e) — POST /api/feedback.
 * Reachable from the 📮 dock button; submissions land in the staff
 * triage backlog (GET /api/feedback).
 */
export class FeedbackPanel {
  private static overlay: HTMLElement | null = null;

  static show(): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'feedback-panel-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    overlay.innerHTML = `
      <div style="
        background:#1b1b36;border:1px solid rgba(255,255,255,0.18);border-radius:16px;
        color:#fff;width:min(440px, calc(100vw - 32px));padding:22px;
        box-shadow:0 12px 48px rgba(0,0,0,0.6);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h2 style="margin:0;font-size:18px">📮 Send Feedback</h2>
          <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <select id="fb-type" style="padding:9px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff;font-family:inherit">
            <option value="BUG">🐞 Bug report</option>
            <option value="FEATURE">💡 Feature idea</option>
            <option value="GENERAL">💬 General feedback</option>
          </select>
          <input id="fb-title" maxlength="120" placeholder="Title" style="padding:9px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff;font-family:inherit"/>
          <textarea id="fb-message" maxlength="1000" rows="5" placeholder="What happened, or what would you love to see?" style="padding:9px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff;font-family:inherit;resize:vertical"></textarea>
          <button data-action="send" style="padding:10px;border-radius:9px;border:none;background:#4ecdc4;color:#12122b;font-weight:600;cursor:pointer;font-family:inherit">Send to the Havens staff</button>
        </div>
      </div>`;

    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    overlay.querySelector('[data-action="send"]')?.addEventListener('click', async () => {
      const type = (overlay.querySelector('#fb-type') as HTMLSelectElement).value as 'BUG' | 'FEATURE' | 'GENERAL';
      const title = escapeHtml((overlay.querySelector('#fb-title') as HTMLInputElement).value.trim());
      const message = (overlay.querySelector('#fb-message') as HTMLTextAreaElement).value.trim();
      if (!title || !message) {
        showToast({ icon: '⚠️', title: 'Feedback', subtitle: 'A title and message are required' });
        return;
      }

      const token = authService.token || (await authService.getToken()) || '';
      try {
        const res = await fetch(`${SERVER_URL}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          credentials: 'include',
          body: JSON.stringify({ type, title, message }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Submission failed' }));
          showToast({ icon: '⚠️', title: 'Feedback', subtitle: data.error ?? 'Submission failed' });
          return;
        }
        showToast({ icon: '💌', title: 'Feedback sent!', subtitle: 'Thank you for making Haven better' });
        this.dismiss();
      } catch {
        showToast({ icon: '⚠️', title: 'Feedback', subtitle: 'Network error' });
      }
    });
  }

  static dismiss(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
