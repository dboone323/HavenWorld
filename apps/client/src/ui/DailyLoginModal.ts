import { API_URL } from '../config';
import { authService } from '../services/auth';
import { showToast } from './ToastNotification';

interface DailyClaimResponse {
  alreadyClaimed: boolean;
  streak: number;
  coinsAwarded: number;
}

/**
 * DailyLoginModal — shown once per day on game entry if the player has a
 * login streak to claim. Displays the streak day badge and coins awarded,
 * then auto-closes after 4 seconds or on button click.
 */
export class DailyLoginModal {
  private static panel: HTMLElement | null = null;

  static async tryShow(explicit = false): Promise<void> {
    const token = authService.token || (await authService.getToken());
    if (!token) return;

    let data: DailyClaimResponse;
    try {
      const res = await fetch(`${API_URL}/users/daily-claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) return;
      data = await res.json() as DailyClaimResponse;
    } catch {
      return; // Non-critical — don't block game load
    }

    if (data.alreadyClaimed || data.coinsAwarded === 0) {
      if (explicit) {
        showToast({
          icon: '🎁',
          title: 'Daily Bonus',
          subtitle: `Already claimed today! Current streak: ${data.streak} day(s).`,
        });
      }
      return;
    }

    DailyLoginModal.show(data.streak, data.coinsAwarded);
  }

  static show(streak: number, coinsAwarded: number): void {
    // Remove any existing modal
    DailyLoginModal.dismiss();

    const panel = document.createElement('div');
    panel.id = 'daily-login-modal';
    panel.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: inherit;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 20px;
      padding: 32px 40px;
      text-align: center;
      color: #fff;
      max-width: 340px;
      width: 90%;
      box-shadow: 0 8px 48px rgba(0,0,0,0.6);
      animation: fadeInScale 0.3s ease;
    `;

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeInScale {
        from { opacity: 0; transform: scale(0.85); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);

    const flame = streak >= 7 ? '🔥' : streak >= 3 ? '⭐' : '🌟';
    card.innerHTML = `
      <div style="font-size: 3rem; margin-bottom: 12px;">${flame}</div>
      <h2 style="margin: 0 0 6px; font-size: 1.4rem;">Daily Login Reward</h2>
      <p style="margin: 0 0 20px; color: rgba(255,255,255,0.65); font-size: 0.9rem;">
        Day ${streak} streak!
      </p>
      <div style="
        background: rgba(255,215,0,0.12);
        border: 1px solid rgba(255,215,0,0.3);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 24px;
        font-size: 1.6rem;
        font-weight: 700;
        color: #ffd700;
      ">
        🪙 +${coinsAwarded} Coins
      </div>
      <button id="daily-login-collect" style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        border-radius: 10px;
        color: #fff;
        font-size: 1rem;
        font-weight: 600;
        padding: 12px 32px;
        cursor: pointer;
        width: 100%;
      ">Collect!</button>
    `;

    panel.appendChild(card);
    document.body.appendChild(panel);
    DailyLoginModal.panel = panel;

    const collectBtn = card.querySelector('#daily-login-collect') as HTMLButtonElement;
    collectBtn?.addEventListener('click', () => DailyLoginModal.dismiss());
    panel.addEventListener('click', (e) => {
      if (e.target === panel) DailyLoginModal.dismiss();
    });

    // Auto-dismiss after 4 seconds
    setTimeout(() => DailyLoginModal.dismiss(), 4000);

    // Update coin display in HUD
    const coinAmount = document.getElementById('coin-amount');
    if (coinAmount) {
      const current = parseInt(coinAmount.textContent || '0', 10);
      coinAmount.textContent = String(current + coinsAwarded);
    }
  }

  static dismiss(): void {
    DailyLoginModal.panel?.remove();
    DailyLoginModal.panel = null;
  }
}
