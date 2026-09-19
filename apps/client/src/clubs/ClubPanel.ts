import { API_URL } from '../config';
import { authService } from '../services/auth';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';

interface ClubSummary {
  id: string;
  name: string;
  motto?: string;
  tag?: string;
  ownerName: string;
  memberCount: number;
}

export class ClubPanel {
  private static overlay: HTMLElement | null = null;

  static async show(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'club-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1b1b36; border: 1px solid rgba(255,255,255,0.18);
      border-radius: 16px; width: 480px; max-height: 85vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h2 style="margin:0; font-size:1.3rem;">🏰 Player Clubs</h2>
        <button id="club-panel-close" style="background:none; border:none; color:#aaa; font-size:1.4rem; cursor:pointer;">✕</button>
      </div>

      <div style="display:flex; gap:8px; margin-bottom:16px;">
        <button id="tab-browse-clubs" style="
          flex:1; background:rgba(255,255,255,0.1); border:none; border-radius:8px;
          color:#fff; padding:8px; font-weight:600; cursor:pointer; font-size:0.85rem;
        ">Browse Clubs</button>
        <button id="tab-create-club" style="
          flex:1; background:transparent; border:1px solid rgba(255,255,255,0.15); border-radius:8px;
          color:rgba(255,255,255,0.7); padding:8px; font-weight:600; cursor:pointer; font-size:0.85rem;
        ">Create Club</button>
      </div>

      <div id="club-content-area">
        <div id="club-list-container" style="display:flex; flex-direction:column; gap:10px;">
          <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Loading clubs...</p>
        </div>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.querySelector('#club-panel-close')?.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });

    const tabBrowse = panel.querySelector('#tab-browse-clubs') as HTMLButtonElement;
    const tabCreate = panel.querySelector('#tab-create-club') as HTMLButtonElement;

    tabBrowse.addEventListener('click', () => {
      tabBrowse.style.background = 'rgba(255,255,255,0.1)';
      tabCreate.style.background = 'transparent';
      this.renderBrowse(panel);
    });

    tabCreate.addEventListener('click', () => {
      tabCreate.style.background = 'rgba(255,255,255,0.1)';
      tabBrowse.style.background = 'transparent';
      this.renderCreate(panel);
    });

    this.renderBrowse(panel);
  }

  private static async renderBrowse(panel: HTMLElement): Promise<void> {
    const contentArea = panel.querySelector('#club-content-area');
    if (!contentArea) return;
    contentArea.innerHTML = '<div id="club-list-container" style="display:flex; flex-direction:column; gap:10px;"><p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Loading clubs...</p></div>';

    const token = authService.getToken();
    try {
      const res = await fetch(`${API_URL}/clubs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const clubs: ClubSummary[] = await res.json();

      const container = panel.querySelector('#club-list-container');
      if (!container) return;
      container.innerHTML = '';

      if (clubs.length === 0) {
        container.innerHTML = '<p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">No clubs founded yet. Be the first!</p>';
        return;
      }

      for (const c of clubs) {
        const row = document.createElement('div');
        row.style.cssText = `
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; align-items: center;
        `;

        row.innerHTML = `
          <div>
            <div style="font-weight:600; font-size:0.95rem;">${c.name} ${c.tag ? `[${c.tag}]` : ''}</div>
            <div style="font-size:0.8rem; color:rgba(255,255,255,0.6); margin-top:2px;">
              ${c.motto || 'No motto'} • ${c.memberCount}/50 members
            </div>
          </div>
          <button class="btn-join-club" data-club-id="${c.id}" style="
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border: none; border-radius: 8px; color: #fff; padding: 6px 14px;
            font-size: 0.85rem; font-weight: 600; cursor: pointer;
          ">Join</button>
        `;

        row.querySelector('.btn-join-club')?.addEventListener('click', async () => {
          const resJoin = await fetch(`${API_URL}/clubs/${c.id}/join`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resJoin.ok) {
            alert(`Joined ${c.name}!`);
            this.dismiss();
          } else {
            const err = await resJoin.json();
            alert(err.error || 'Failed to join club');
          }
        });

        container.appendChild(row);
      }
    } catch {
      /* ignore */
    }
  }

  private static renderCreate(panel: HTMLElement): void {
    const contentArea = panel.querySelector('#club-content-area');
    if (!contentArea) return;

    contentArea.innerHTML = `
      <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px;">
        <p style="margin:0 0 12px; font-size:0.85rem; color:rgba(255,255,255,0.7);">
          Found a club for <b>500 HavenCoins</b>. Includes a private clubhouse room for all members!
        </p>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <input id="create-club-name" type="text" placeholder="Club Name (3-24 chars)" maxlength="24" style="
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); border-radius:8px;
            color:#fff; padding:8px 12px; font-size:0.9rem;
          " />
          <input id="create-club-tag" type="text" placeholder="Club Tag (up to 5 chars, e.g. STAR)" maxlength="5" style="
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); border-radius:8px;
            color:#fff; padding:8px 12px; font-size:0.9rem;
          " />
          <input id="create-club-motto" type="text" placeholder="Motto" maxlength="80" style="
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); border-radius:8px;
            color:#fff; padding:8px 12px; font-size:0.9rem;
          " />
          <button id="btn-submit-create-club" style="
            background:linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            border:none; border-radius:8px; color:#fff; padding:10px; font-weight:600; cursor:pointer; margin-top:4px;
          ">Found Club (🪙 500)</button>
        </div>
      </div>
    `;

    panel.querySelector('#btn-submit-create-club')?.addEventListener('click', async () => {
      const name = (panel.querySelector('#create-club-name') as HTMLInputElement).value.trim();
      const tag = (panel.querySelector('#create-club-tag') as HTMLInputElement).value.trim();
      const motto = (panel.querySelector('#create-club-motto') as HTMLInputElement).value.trim();

      if (name.length < 3) {
        alert('Club name must be at least 3 characters.');
        return;
      }

      const token = authService.getToken();
      const res = await fetch(`${API_URL}/clubs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, tag, motto }),
      });

      if (res.ok) {
        alert(`🎉 Club "${name}" founded successfully!`);
        this.dismiss();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create club');
      }
    });
  }

  static dismiss(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
