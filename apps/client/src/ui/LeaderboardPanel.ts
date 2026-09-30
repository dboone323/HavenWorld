import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface Ranking {
  rank: number;
  username: string;
  score: number;
}

const CATEGORIES = [
  { key: 'RICHEST_PLAYERS', icon: '🪙', label: 'Richest' },
  { key: 'MASTER_CHEFS', icon: '🍕', label: 'Chefs' },
  { key: 'MASTER_ANGLERS', icon: '🎣', label: 'Anglers' },
  { key: 'TOP_DECORATORS', icon: '🛋️', label: 'Decorators' },
] as const;

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Leaderboard board UI (roadmap §3c) — GET /api/leaderboard?category=…
 * Mirrors the in-game plaza display board categories.
 */
export class LeaderboardPanel {
  private static overlay: HTMLElement | null = null;
  private static category: (typeof CATEGORIES)[number]['key'] = 'RICHEST_PLAYERS';

  static async open(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'leaderboard-panel-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#1b1b36; border:1px solid rgba(255,255,255,0.18); border-radius:16px;
      color:#fff; width:min(480px, calc(100vw - 32px)); max-height:82vh; overflow-y:auto;
      padding:22px; box-shadow:0 12px 48px rgba(0,0,0,0.6);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    await this.refresh(panel);
  }

  private static async refresh(panel: HTMLElement): Promise<void> {
    let rankings: Ranking[] = [];
    try {
      const res = await fetch(`${SERVER_URL}/api/leaderboard?category=${this.category}`, {
        headers: { Authorization: `Bearer ${authService.token ?? ''}` },
        credentials: 'include',
      });
      if (res.ok) rankings = (await res.json()) as Ranking[];
    } catch {
      showToast({ icon: '⚠️', title: 'Leaderboard', subtitle: 'Network error' });
    }
    if (this.overlay) this.render(panel, rankings);
  }

  private static render(panel: HTMLElement, rankings: Ranking[]): void {
    const tabs = CATEGORIES.map((c) => {
      const active = this.category === c.key;
      return `<button data-cat="${c.key}" style="
        padding:6px 11px;margin-right:6px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;color:#fff;
        background:${active ? 'rgba(201,162,39,0.35)' : 'rgba(255,255,255,0.08)'};
        border:1px solid ${active ? 'rgba(201,162,39,0.8)' : 'rgba(255,255,255,0.15)'};
      ">${c.icon} ${c.label}</button>`;
    }).join('');

    const rows = rankings.length === 0
      ? '<p style="font-size:13px;opacity:0.65">No rankings yet this season.</p>'
      : rankings.map((r) => `
          <div style="display:flex;align-items:center;gap:12px;padding:9px 12px;margin-bottom:6px;
            background:${r.rank <= 3 ? 'rgba(201,162,39,0.12)' : 'rgba(255,255,255,0.05)'};
            border:1px solid rgba(255,255,255,0.08);border-radius:10px;font-size:14px">
            <span style="width:34px;text-align:center">${MEDALS[r.rank - 1] ?? `#${r.rank}`}</span>
            <span style="flex:1">${escapeHtml(r.username)}</span>
            <span style="color:#f0ad4e;font-weight:600">${r.score.toLocaleString()}</span>
          </div>`).join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0;font-size:18px">🏆 Plaza Leaderboard</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="margin-bottom:14px">${tabs}</div>
      ${rows}`;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    panel.querySelectorAll<HTMLElement>('[data-cat]').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.category = tab.dataset.cat as typeof this.category;
        this.refresh(panel);
      });
    });
  }

  static dismiss(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
