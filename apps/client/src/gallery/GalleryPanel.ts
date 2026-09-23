import { API_URL } from '../config';
import { authService } from '../services/auth';
import { escapeHtml } from '../utils/escapeHtml';

interface GalleryPhoto {
  id: string;
  authorName: string;
  imageUrl: string;
  caption?: string;
  likes: number;
  roomName: string;
  isLikedByMe: boolean;
}

export class GalleryPanel {
  private static overlay: HTMLElement | null = null;

  static async show(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'gallery-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #18182e; border: 1px solid rgba(255,255,255,0.18);
      border-radius: 16px; width: 540px; max-height: 85vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h2 style="margin:0; font-size:1.3rem;">📷 Haven Gallery</h2>
        <div style="display:flex; gap:10px; align-items:center;">
          <button id="btn-snap-photo" style="
            background: linear-gradient(135deg, #ec4899 0%, #d946ef 100%);
            border: none; border-radius: 8px; color: #fff; padding: 6px 14px;
            font-size: 0.85rem; font-weight: 600; cursor: pointer;
          ">📸 Snap Photo</button>
          <button id="gallery-panel-close" style="background:none; border:none; color:#aaa; font-size:1.4rem; cursor:pointer;">✕</button>
        </div>
      </div>

      <div id="gallery-photo-grid" style="
        display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 16px; margin-top: 16px;
      ">
        <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Loading photos...</p>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.querySelector('#gallery-panel-close')?.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });

    panel.querySelector('#btn-snap-photo')?.addEventListener('click', () => {
      this.snapAndUpload(panel);
    });

    await this.loadPhotos(panel);
  }

  private static async loadPhotos(panel: HTMLElement): Promise<void> {
    const grid = panel.querySelector('#gallery-photo-grid');
    if (!grid) return;

    const token = authService.token || (await authService.getToken());
    try {
      const res = await fetch(`${API_URL}/gallery`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const photos: GalleryPhoto[] = await res.json();

      grid.innerHTML = '';
      if (photos.length === 0) {
        grid.innerHTML = '<p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">No photos yet. Click Snap Photo to take one!</p>';
        return;
      }

      for (const p of photos) {
        const card = document.createElement('div');
        card.style.cssText = `
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;
        `;

        card.innerHTML = `
          <div style="width:100%; height:130px; background:#000; overflow:hidden; display:flex; align-items:center; justify-content:center;">
            <img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.caption || 'Haven photo')}" style="width:100%; height:100%; object-fit:cover;" />
          </div>
          <div style="padding:10px; display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:0.85rem; font-weight:600;">${escapeHtml(p.caption || 'Untitled')}</div>
            <div style="font-size:0.75rem; color:rgba(255,255,255,0.5);">By ${escapeHtml(p.authorName)} • ${escapeHtml(p.roomName)}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
              <button class="btn-like-photo" data-photo-id="${escapeHtml(p.id)}" style="
                background: ${p.isLikedByMe ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.08)'};
                border: 1px solid ${p.isLikedByMe ? '#ec4899' : 'rgba(255,255,255,0.15)'};
                border-radius: 6px; color:#fff; padding:4px 10px; font-size:0.8rem; cursor:pointer;
              ">❤️ <span class="like-count">${p.likes}</span></button>
            </div>
          </div>
        `;

        card.querySelector('.btn-like-photo')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          const resLike = await fetch(`${API_URL}/gallery/${p.id}/like`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resLike.ok) {
            const data = await resLike.json();
            const countEl = btn.querySelector('.like-count');
            if (countEl) {
              const current = parseInt(countEl.textContent || '0', 10);
              countEl.textContent = String(data.liked ? current + 1 : Math.max(0, current - 1));
            }
          }
        });

        grid.appendChild(card);
      }
    } catch {
      /* ignore */
    }
  }

  private static async snapAndUpload(panel: HTMLElement): Promise<void> {
    const canvas = document.getElementById('haven-canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('Cannot capture screenshot: Canvas not found');
      return;
    }

    const caption = prompt('Add a caption for your photo:');
    if (caption === null) return;

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const token = authService.token || (await authService.getToken());

      const res = await fetch(`${API_URL}/gallery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageUrl: dataUrl,
          caption: caption.trim() || 'Haven Snapshot',
          roomName: (window as any).__havenRoomId || 'Haven Park',
        }),
      });

      if (res.ok) {
        alert('📸 Photo published to gallery!');
        this.loadPhotos(panel);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to upload photo');
      }
    } catch (err: any) {
      alert('Screenshot capture failed: ' + err.message);
    }
  }

  static dismiss(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
