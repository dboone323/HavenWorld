import { SOCKET_EVENTS, type MoodId } from '@havenworld/shared';
import { API_URL } from '../config';
import { authService } from '../services/auth';

type PrivacyMode = 'PUBLIC' | 'FRIENDS_ONLY' | 'PASSWORD_PROTECTED' | 'LOCKED';

interface LoftSettingsOptions {
  roomId: string;
  ownerId: string;
  currentPrivacy?: PrivacyMode;
  currentMood?: MoodId;
  onPrivacyChange?: (mode: PrivacyMode, password?: string) => void;
  onMoodChange?: (mood: MoodId) => void;
}

/**
 * LoftSettingsPanel — owner-only panel for managing loft privacy, ambient mood,
 * guestbook settings, and decorator permissions.
 */
export class LoftSettingsPanel {
  private panel: HTMLElement | null = null;
  private opts: LoftSettingsOptions;

  constructor(opts: LoftSettingsOptions) {
    this.opts = opts;
  }

  show(): void {
    if (this.panel) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 9500; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15);
      border-radius: 16px; width: 360px; max-height: 80vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    `;

    // ── Header ────────────────────────────────────────────────────────────────
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h2 style="margin:0;font-size:1.1rem;">⚙️ Loft Settings</h2>
        <button id="loft-settings-close" style="background:none;border:none;color:#aaa;font-size:1.3rem;cursor:pointer;">✕</button>
      </div>

      <!-- Privacy Tab -->
      <section style="margin-bottom:20px;">
        <h3 style="margin:0 0 10px;font-size:0.85rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;">Privacy</h3>
        <div id="privacy-options" style="display:flex;flex-direction:column;gap:8px;">
          ${(['PUBLIC', 'FRIENDS_ONLY', 'PASSWORD_PROTECTED', 'LOCKED'] as PrivacyMode[]).map(mode => `
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.04);">
              <input type="radio" name="privacy-mode" value="${mode}" ${this.opts.currentPrivacy === mode ? 'checked' : ''}>
              <span style="font-size:0.875rem;">${LoftSettingsPanel.privacyLabel(mode)}</span>
            </label>
          `).join('')}
        </div>
        <div id="password-field" style="margin-top:10px;display:${this.opts.currentPrivacy === 'PASSWORD_PROTECTED' ? 'block' : 'none'};">
          <input id="loft-password" type="password" placeholder="Set loft password" style="
            width:100%;box-sizing:border-box;background:rgba(255,255,255,0.08);
            border:1px solid rgba(255,255,255,0.15);border-radius:8px;
            color:#fff;padding:8px 12px;font-size:0.875rem;
          ">
        </div>
        <button id="save-privacy" style="
          margin-top:12px;width:100%;background:rgba(102,126,234,0.8);
          border:none;border-radius:8px;color:#fff;padding:9px;cursor:pointer;font-size:0.875rem;
        ">Save Privacy</button>
      </section>

      <!-- Mood Tab -->
      <section style="margin-bottom:20px;">
        <h3 style="margin:0 0 10px;font-size:0.85rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;">Ambient Mood</h3>
        <select id="mood-select" style="
          width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
          border-radius:8px;color:#fff;padding:9px 12px;font-size:0.875rem;cursor:pointer;
        ">
          ${(['day', 'dusk', 'night', 'cyber_neon', 'golden_hour', 'haunted', 'arctic', 'cozy_evening'] as MoodId[]).map(m => `
            <option value="${m}" ${this.opts.currentMood === m ? 'selected' : ''}>${LoftSettingsPanel.moodLabel(m)}</option>
          `).join('')}
        </select>
        <button id="save-mood" style="
          margin-top:10px;width:100%;background:rgba(102,126,234,0.8);
          border:none;border-radius:8px;color:#fff;padding:9px;cursor:pointer;font-size:0.875rem;
        ">Apply Mood</button>
      </section>

      <!-- Decorator -->
      <section>
        <h3 style="margin:0 0 10px;font-size:0.85rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;">Decorators</h3>
        <div style="display:flex;gap:8px;">
          <input id="decorator-username" type="text" placeholder="Username" style="
            flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
            border-radius:8px;color:#fff;padding:8px 12px;font-size:0.875rem;
          ">
          <button id="grant-decorator-btn" style="
            background:rgba(34,197,94,0.7);border:none;border-radius:8px;
            color:#fff;padding:8px 14px;cursor:pointer;font-size:0.875rem;
          ">Grant</button>
          <button id="revoke-decorator-btn" style="
            background:rgba(239,68,68,0.7);border:none;border-radius:8px;
            color:#fff;padding:8px 14px;cursor:pointer;font-size:0.875rem;
          ">Revoke</button>
        </div>
      </section>
    `;

    panel.querySelector('#loft-settings-close')?.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.dismiss(); });

    // Privacy radio toggle
    const privacyOptions = panel.querySelector('#privacy-options')!;
    const passwordField = panel.querySelector('#password-field') as HTMLElement;
    privacyOptions.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value;
      passwordField.style.display = val === 'PASSWORD_PROTECTED' ? 'block' : 'none';
    });

    // Save privacy
    panel.querySelector('#save-privacy')?.addEventListener('click', () => {
      const mode = (panel.querySelector('input[name="privacy-mode"]:checked') as HTMLInputElement)?.value as PrivacyMode;
      const password = (panel.querySelector('#loft-password') as HTMLInputElement)?.value || undefined;
      this.opts.onPrivacyChange?.(mode, password);
    });

    // Save mood
    panel.querySelector('#save-mood')?.addEventListener('click', () => {
      const mood = (panel.querySelector('#mood-select') as HTMLSelectElement).value as MoodId;
      this.opts.onMoodChange?.(mood);
    });

    // Decorator grant/revoke — resolved via user lookup
    const resolveTargetUserId = async (username: string): Promise<string | null> => {
      const token = authService.getToken();
      if (!token || !username.trim()) return null;
      const res = await fetch(`${API_URL}/users/by-username/${encodeURIComponent(username.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const user = await res.json();
      return user.id ?? null;
    };

    panel.querySelector('#grant-decorator-btn')?.addEventListener('click', async () => {
      const username = (panel.querySelector('#decorator-username') as HTMLInputElement).value;
      const targetUserId = await resolveTargetUserId(username);
      if (!targetUserId) { alert('User not found'); return; }
      // Emitting handled by the caller via onPrivacyChange — here we fire the socket directly
      const { socketService } = await import('../services/socket');
      socketService.socket?.emit(SOCKET_EVENTS.GRANT_DECORATOR, { roomId: this.opts.roomId, targetUserId });
    });

    panel.querySelector('#revoke-decorator-btn')?.addEventListener('click', async () => {
      const username = (panel.querySelector('#decorator-username') as HTMLInputElement).value;
      const targetUserId = await resolveTargetUserId(username);
      if (!targetUserId) { alert('User not found'); return; }
      const { socketService } = await import('../services/socket');
      socketService.socket?.emit(SOCKET_EVENTS.REVOKE_DECORATOR, { roomId: this.opts.roomId, targetUserId });
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.panel = overlay;
  }

  dismiss(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private static privacyLabel(mode: PrivacyMode): string {
    return {
      PUBLIC: '🌍 Public — anyone can enter',
      FRIENDS_ONLY: '👥 Friends Only',
      PASSWORD_PROTECTED: '🔒 Password Protected',
      LOCKED: '🚫 Locked — doorbell only',
    }[mode] ?? mode;
  }

  private static moodLabel(mood: MoodId): string {
    return {
      day: '☀️ Daylight',
      dusk: '🌆 Twilight Dusk',
      night: '🌙 Midnight',
      cyber_neon: '⚡ Cyber Neon',
      golden_hour: '✨ Golden Hour',
      haunted: '👻 Haunted Mansion',
      arctic: '❄️ Arctic Chill',
      cozy_evening: '☕ Cozy Fireplace',
    }[mood] ?? mood;
  }
}
