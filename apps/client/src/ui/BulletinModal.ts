import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface BulletinPost {
  id: string;
  authorName: string;
  category: 'TRADE' | 'GUILD' | 'SOCIAL';
  title: string;
  body: string;
  createdAt: string;
}

const CATEGORY_META: Record<BulletinPost['category'], { icon: string; label: string }> = {
  TRADE: { icon: '🧺', label: 'Trade' },
  GUILD: { icon: '🏰', label: 'Guild' },
  SOCIAL: { icon: '💌', label: 'Social' },
};

/**
 * Plaza bulletin corkboard (roadmap §3m) — HTTP-backed (GET/POST /api/bulletin).
 * Posts expire server-side after 48h; the board shows all active notes.
 */
export class BulletinModal {
  private static overlay: HTMLElement | null = null;
  private static posts: BulletinPost[] = [];
  private static filter: 'ALL' | BulletinPost['category'] = 'ALL';

  static async open(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'bulletin-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#2a2118; border:2px solid #8d6e4b; border-radius:14px; color:#fff;
      width:min(560px, calc(100vw - 32px)); max-height:86vh; overflow-y:auto;
      padding:22px; box-shadow:0 12px 48px rgba(0,0,0,0.65);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    this.render(panel, 'Loading corkboard…');
    await this.fetchPosts();
    if (this.overlay) this.render(panel);
  }

  private static async fetchPosts(): Promise<void> {
    try {
      const suffix = this.filter === 'ALL' ? '' : `?category=${this.filter}`;
      const res = await fetch(`${SERVER_URL}/api/bulletin${suffix}`);
      this.posts = res.ok ? (await res.json()) as BulletinPost[] : [];
    } catch {
      this.posts = [];
    }
  }

  private static render(panel: HTMLElement, loadingNote?: string): void {
    const tabs = (['ALL', 'TRADE', 'GUILD', 'SOCIAL'] as const).map((key) => {
      const active = this.filter === key;
      const icon = key === 'ALL' ? '📋' : CATEGORY_META[key].icon;
      const label = key === 'ALL' ? 'All' : CATEGORY_META[key].label;
      return `<button data-tab="${key}" style="
        padding:6px 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;
        color:#fff;margin-right:6px;
        background:${active ? 'rgba(240,173,78,0.35)' : 'rgba(255,255,255,0.08)'};
        border:1px solid ${active ? 'rgba(240,173,78,0.8)' : 'rgba(255,255,255,0.15)'};
      ">${icon} ${label}</button>`;
    }).join('');

    const notes = this.posts.length === 0
      ? `<p style="font-size:13px;opacity:0.65">${loadingNote ?? 'The corkboard is empty — pin the first note!'}</p>`
      : this.posts.map((post) => `
          <div style="
            background:#f7ecd4; color:#3b2f1e; border-radius:8px; padding:12px 14px;
            margin-bottom:10px; transform:rotate(${(post.id.charCodeAt(post.id.length - 1) % 5) - 2}deg);
            box-shadow:2px 3px 8px rgba(0,0,0,0.35); position:relative;
          ">
            <span style="position:absolute;top:-8px;left:50%;font-size:14px">📌</span>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <strong style="font-size:14px">${escapeHtml(post.title)}</strong>
              <span style="font-size:11px">${CATEGORY_META[post.category]?.icon ?? '📝'} ${escapeHtml(post.category)}</span>
            </div>
            <p style="margin:6px 0 4px;font-size:13px;white-space:pre-wrap;word-break:break-word">${escapeHtml(post.body)}</p>
            <span style="font-size:11px;opacity:0.7">— ${escapeHtml(post.authorName)} · ${new Date(post.createdAt).toLocaleDateString()}</span>
          </div>`).join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0;font-size:18px">📌 Plaza Corkboard</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="margin-bottom:14px">${tabs}</div>
      ${notes}
      <details style="margin-top:14px">
        <summary style="cursor:pointer;font-size:14px;color:#f0ad4e">🖊️ Pin a new note</summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          <select id="bulletin-category" style="padding:8px;border-radius:8px;background:#3b2f1e;color:#fff;border:1px solid rgba(255,255,255,0.2)">
            <option value="SOCIAL">💌 Social</option>
            <option value="TRADE">🧺 Trade</option>
            <option value="GUILD">🏰 Guild</option>
          </select>
          <input id="bulletin-title" maxlength="60" placeholder="Title (3–60 chars)" style="padding:8px;border-radius:8px;background:#3b2f1e;color:#fff;border:1px solid rgba(255,255,255,0.2)"/>
          <textarea id="bulletin-body" maxlength="300" rows="3" placeholder="Message (5–300 chars) — notes expire after 48h" style="padding:8px;border-radius:8px;background:#3b2f1e;color:#fff;border:1px solid rgba(255,255,255,0.2);font-family:inherit"></textarea>
          <button data-action="pin" style="padding:9px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-weight:600;background:#f0ad4e;color:#3b2f1e">Pin to Corkboard</button>
        </div>
      </details>
    `;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) => {
      tab.addEventListener('click', async () => {
        this.filter = tab.dataset.tab as typeof this.filter;
        await this.fetchPosts();
        if (this.overlay) this.render(panel);
      });
    });
    panel.querySelector('[data-action="pin"]')?.addEventListener('click', async () => {
      const category = (panel.querySelector('#bulletin-category') as HTMLSelectElement).value as BulletinPost['category'];
      const title = (panel.querySelector('#bulletin-title') as HTMLInputElement).value.trim();
      const body = (panel.querySelector('#bulletin-body') as HTMLTextAreaElement).value.trim();

      const token = authService.token || (await authService.getToken()) || '';
      try {
        const res = await fetch(`${SERVER_URL}/api/bulletin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          credentials: 'include',
          body: JSON.stringify({ category, title, body }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Posting failed' }));
          showToast({ icon: '⚠️', title: 'Corkboard', subtitle: data.error ?? 'Posting failed' });
          return;
        }
        showToast({ icon: '📌', title: 'Note pinned!', subtitle: 'Visible in the plaza for 48 hours' });
        await this.fetchPosts();
        if (this.overlay) this.render(panel);
      } catch {
        showToast({ icon: '⚠️', title: 'Corkboard', subtitle: 'Network error' });
      }
    });
  }

  static dismiss(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
