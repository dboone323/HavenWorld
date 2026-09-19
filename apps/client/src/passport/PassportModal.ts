import { authService } from '../services/auth';
import type { PassportData } from '@havenworld/shared';
import { SERVER_URL } from '../config';

export const STAMP_NAMES = [
  'First Step',
  'World Traveler',
  'Master Angler',
  'Friendly Spirit',
  'Sanctuary Decorator',
  'Social Butterfly',
  'Tip Royale',
  'Craft Master',
  'Pizza Pro',
  'Fish and Chips',
  'Streaker',
  'Legendary Catch',
  'Club Founder',
  'Haven VIP',
  'Home Sweet Home',
];

export class PassportModal {
  private overlay: HTMLElement | null = null;

  async open(targetUserId?: string): Promise<void> {
    const userId = targetUserId || authService.user?.id;
    if (!userId || this.overlay) return;

    const token = authService.token || (await authService.getToken()) || '';

    try {
      const res = await fetch(`${SERVER_URL}/api/passport/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!res.ok) {
        alert('Could not load passport');
        return;
      }

      const passport: PassportData = await res.json();
      this.render(passport);
    } catch {
      alert('Failed to connect to passport service');
    }
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private render(passport: PassportData): void {
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'passport-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
    `;

    const earnedStamps = new Set(passport.stamps.map((s) => s.stamp));
    const joinDateStr = new Date(passport.joinDate).toLocaleDateString();

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1e1b4b;
      border: 2px solid #818cf8;
      border-radius: 12px;
      width: min(680px, 94vw);
      max-height: 90vh;
      overflow-y: auto;
      padding: 24px;
      color: #e2e8f0;
      box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3);
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 50px; height: 50px; border-radius: 50%; background: #4f46e5; display: flex; align-items: center; justify-content: center; font-size: 1.6rem;">
            🛂
          </div>
          <div>
            <h2 style="margin: 0; font-size: 1.4rem; color: #a5b4fc;">${passport.username}'s Passport</h2>
            <div style="font-size: 0.8rem; color: #94a3b8;">Citizen since ${joinDateStr} · ${passport.stamps.length}/20 Stamps</div>
          </div>
        </div>
        <button id="btn-close-passport" style="background: transparent; border: none; color: #aaa; font-size: 1.4rem; cursor: pointer;">✕</button>
      </div>

      <!-- Stats Row -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
        <div style="background: #312e81; padding: 10px; border-radius: 8px; text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #38bdf8;">${passport.fishCount}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Fish Caught</div>
        </div>
        <div style="background: #312e81; padding: 10px; border-radius: 8px; text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #ffd700;">${passport.totalTips} 🪙</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Loft Tips Received</div>
        </div>
        <div style="background: #312e81; padding: 10px; border-radius: 8px; text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #4ecdc4;">${passport.completedTrades}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Trades Completed</div>
        </div>
      </div>

      <!-- 20-Stamp Grid (4x5) -->
      <div style="font-weight: bold; margin-bottom: 12px; color: #c7d2fe;">Achievement Stamps</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px;">
        ${STAMP_NAMES.map((name) => {
          const isEarned = earnedStamps.has(name);
          return `
            <div style="background: ${isEarned ? '#3730a3' : '#1e1b4b'}; border: 1px solid ${isEarned ? '#818cf8' : '#312e81'}; border-radius: 8px; padding: 10px; text-align: center; opacity: ${isEarned ? '1' : '0.45'}; transition: transform 120ms;">
              <div style="font-size: 1.5rem; margin-bottom: 4px;">${isEarned ? '🏅' : '🔒'}</div>
              <div style="font-size: 0.75rem; font-weight: 600; color: #fff;">${name}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    panel.querySelector('#btn-close-passport')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }
}
