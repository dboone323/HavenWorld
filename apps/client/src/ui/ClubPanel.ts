import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface ClubSummary {
  id: string;
  name: string;
  motto: string;
  tag: string;
  ownerName: string;
  memberCount: number;
}

interface ClubMemberRow {
  role: string;
  user: { id: string; username: string; lastLoginAt: string | null };
}

interface ClubDetail {
  id: string;
  name: string;
  motto: string;
  tag: string;
  members: ClubMemberRow[];
}

/**
 * Guild/clubs panel (roadmap §3b) — my-club view with roster, club browser
 * with join, and a create form (500 HavenCoins, enforced server-side).
 */
export class ClubPanel {
  private static overlay: HTMLElement | null = null;

  private static async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authService.token ?? ''}`,
        },
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast({ icon: '⚠️', title: 'Clubs', subtitle: (data as { error?: string })?.error ?? 'Request failed' });
        return null;
      }
      return data as T;
    } catch {
      showToast({ icon: '⚠️', title: 'Clubs', subtitle: 'Network error' });
      return null;
    }
  }

  static async open(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'club-panel-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#1b1b36; border:1px solid rgba(255,255,255,0.18); border-radius:16px;
      color:#fff; width:min(540px, calc(100vw - 32px)); max-height:86vh; overflow-y:auto;
      padding:22px; box-shadow:0 12px 48px rgba(0,0,0,0.6);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.innerHTML = '<p style="opacity:0.7">Loading clubs…</p>';
    await this.refresh(panel);
  }

  private static async refresh(panel: HTMLElement): Promise<void> {
    const mine = await this.request<ClubDetail | null>('GET', '/api/clubs/me');
    const clubs = await this.request<ClubSummary[]>('GET', '/api/clubs');
    if (this.overlay) this.render(panel, mine, clubs ?? []);
  }

  private static render(panel: HTMLElement, mine: ClubDetail | null, clubs: ClubSummary[]): void {
    const myClubSection = mine
      ? `
        <div style="background:rgba(108,59,160,0.2);border:1px solid rgba(160,110,220,0.6);border-radius:12px;padding:14px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <strong style="font-size:16px">🏰 ${escapeHtml(mine.name)} <span style="color:#c9a227">[${escapeHtml(mine.tag)}]</span></strong>
            <span style="font-size:12px;opacity:0.7">${mine.members.length} members</span>
          </div>
          <p style="margin:4px 0 10px;font-size:13px;font-style:italic;opacity:0.85">"${escapeHtml(mine.motto)}"</p>
          ${mine.members.slice(0, 8).map((m) => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
              <span>${m.role === 'OWNER' ? '👑' : '🧑'} ${escapeHtml(m.user.username)}</span>
              <span style="opacity:0.6">${m.role}</span>
            </div>`).join('')}
        </div>`
      : '';

    const browser = clubs
      .filter((c) => c.id !== mine?.id)
      .map((c) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;
          background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px">
          <span style="flex:1;font-size:14px"><strong>${escapeHtml(c.name)}</strong>
            <span style="color:#c9a227"> [${escapeHtml(c.tag)}]</span>
            <span style="display:block;font-size:12px;opacity:0.65">"${escapeHtml(c.motto)}" · ${c.memberCount}/50 · owner ${escapeHtml(c.ownerName)}</span>
          </span>
          ${mine ? '' : `<button data-join="${c.id}" style="padding:6px 12px;border-radius:8px;border:none;background:#4ecdc4;color:#12122b;font-weight:600;cursor:pointer;font-size:12px">Join</button>`}
        </div>`).join('') || '<p style="font-size:13px;opacity:0.65">No clubs yet — found the first one below!</p>';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0;font-size:18px">🏰 Clubs & Guilds</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      ${myClubSection}
      <h3 style="font-size:14px;margin:0 0 10px;opacity:0.85">Browse clubs</h3>
      ${browser}
      ${mine ? '' : `
        <details style="margin-top:12px">
          <summary style="cursor:pointer;font-size:14px;color:#c0a0f0">👑 Found a new club (costs 🪙 500)</summary>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
            <div style="display:flex;gap:8px">
              <input id="club-name" maxlength="30" placeholder="Club name" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff"/>
              <input id="club-tag" maxlength="5" placeholder="TAG" style="width:80px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff;text-transform:uppercase"/>
            </div>
            <input id="club-motto" maxlength="60" placeholder="Club motto" style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff"/>
            <button data-action="create" style="padding:9px;border-radius:9px;border:none;background:#a06ee0;color:#fff;font-weight:600;cursor:pointer">Found Club</button>
          </div>
        </details>`}`;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    panel.querySelectorAll<HTMLElement>('[data-join]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await this.request('POST', `/api/clubs/${btn.dataset.join}/join`);
        if (ok) {
          showToast({ icon: '🏰', title: 'Welcome to the club!', subtitle: 'Your club now appears at the top' });
          await this.refresh(panel);
        }
      });
    });
    panel.querySelector('[data-action="create"]')?.addEventListener('click', async () => {
      const name = (panel.querySelector('#club-name') as HTMLInputElement).value.trim();
      const tag = ((panel.querySelector('#club-tag') as HTMLInputElement).value || '').trim().toUpperCase();
      const motto = (panel.querySelector('#club-motto') as HTMLInputElement).value.trim();
      if (!name || !tag) {
        showToast({ icon: '⚠️', title: 'Clubs', subtitle: 'Name and tag are required' });
        return;
      }
      const created = await this.request('POST', '/api/clubs', { name, tag, motto: motto || 'Together we thrive' });
      if (created) {
        showToast({ icon: '👑', title: 'Club founded!', subtitle: `${name} [${tag}]` });
        await this.refresh(panel);
      }
    });
  }

  static dismiss(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
