import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { showToast } from './ToastNotification';

interface TutorialStatus {
  step: number;
  completed: boolean;
  welcomeBadgeAt: string | null;
}

const STEPS = [
  { icon: '🚶', title: 'Step 1 — Look around', text: 'Click anywhere on the floor to walk. Visit the Town Square, Park, or Café from the tree/map buttons on the right.' },
  { icon: '💬', title: 'Step 2 — Say hello', text: 'Open the chat box (💬) and greet someone. Try an emote from the wheel too!' },
  { icon: '🎮', title: 'Step 3 — Play something', text: 'Try the fishing dock in the Park, the Connect-4 arcade cabinet in the Square, or stock your loft shop register.' },
];

/**
 * Interactive onboarding overlay (roadmap §3d). The current step lives on the
 * user row (GET /api/tutorial/status); "Got it" advances it server-side.
 * Opens automatically once per session for citizens who have not finished.
 */
export class TutorialOverlay {
  private static overlay: HTMLElement | null = null;
  private static autoShown = false;

  static async maybeAutoOpen(): Promise<void> {
    if (this.autoShown) return;
    this.autoShown = true;
    try {
      const status = await this.fetchStatus();
      if (status && !status.completed && status.step <= STEPS.length) {
        this.render(status);
      }
    } catch {
      /* silent — onboarding is best-effort */
    }
  }

  static async open(): Promise<void> {
    try {
      const status = await this.fetchStatus();
      if (!status) return;
      if (status.completed) {
        showToast({ icon: '🎓', title: 'Tutorial complete!', subtitle: 'You are a full Haven citizen' });
        return;
      }
      this.render(status);
    } catch {
      showToast({ icon: '⚠️', title: 'Tutorial', subtitle: 'Could not load progress' });
    }
  }

  private static async fetchStatus(): Promise<TutorialStatus | null> {
    const token = authService.token || (await authService.getToken()) || '';
    const res = await fetch(`${SERVER_URL}/api/tutorial/status`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    return res.ok ? (await res.json()) as TutorialStatus : null;
  }

  private static render(status: TutorialStatus): void {
    this.dismiss();
    const index = Math.max(0, Math.min(STEPS.length - 1, status.step - 1));
    const step = STEPS[index];

    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.style.cssText = `
      position: fixed; right: 84px; top: 96px; z-index: 9999; font-family: inherit;
      width: min(320px, calc(100vw - 120px));
    `;

    overlay.innerHTML = `
      <div style="
        background:#1b1b36;border:1px solid rgba(78,205,196,0.5);border-radius:14px;
        color:#fff;padding:16px 18px;box-shadow:0 10px 36px rgba(0,0,0,0.55);position:relative;
      ">
        <button data-action="close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#fff;font-size:14px;cursor:pointer">✕</button>
        <div style="font-size:26px">${step.icon}</div>
        <h3 style="margin:6px 0 4px;font-size:15px">${step.title}</h3>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.5;opacity:0.88">${step.text}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button data-action="later" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:none;color:#fff;cursor:pointer;font-family:inherit;font-size:12px">Later</button>
          <button data-action="done" style="padding:7px 14px;border-radius:8px;border:none;background:#4ecdc4;color:#12122b;font-weight:600;cursor:pointer;font-family:inherit;font-size:12px">Got it ✓</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    overlay.querySelector('[data-action="later"]')?.addEventListener('click', () => this.dismiss());
    overlay.querySelector('[data-action="done"]')?.addEventListener('click', async () => {
      const token = authService.token || (await authService.getToken()) || '';
      try {
        const res = await fetch(`${SERVER_URL}/api/tutorial/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          credentials: 'include',
          body: JSON.stringify({ step: status.step + 1 }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Could not save progress' }));
          showToast({ icon: '⚠️', title: 'Tutorial', subtitle: data.error ?? 'Failed' });
          return;
        }
        const next = (await res.json().catch(() => null)) as TutorialStatus | null;
        if (next?.completed) {
          showToast({ icon: '🎓', title: 'Tutorial complete!', subtitle: 'Welcome to Haven for real 🎉' });
          this.dismiss();
        } else {
          this.dismiss();
          TutorialOverlay.open().catch(console.error);
        }
      } catch {
        showToast({ icon: '⚠️', title: 'Tutorial', subtitle: 'Network error' });
      }
    });
  }

  static dismiss(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
