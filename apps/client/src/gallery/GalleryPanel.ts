import { API_URL } from '../config';
import { authService } from '../services/auth';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from '../ui/ToastNotification';

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

  // ── Snap Photo flow ──────────────────────────────────────────────────────
  // The caption is collected through an inline form in the panel (replacing
  // the old prompt()), and the snapshot is downscaled + adaptively
  // compressed so the upload stays well under the server's 50kb JSON body
  // limit (a full-canvas JPEG blew past it → 413 → the button appeared dead).

  private static snapAndUpload(panel: HTMLElement): void {
    const canvas = document.getElementById('haven-canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      showToast({
        icon: '⚠️',
        title: 'Cannot capture screenshot',
        subtitle: 'Game canvas not found',
      });
      return;
    }
    // Don't stack multiple caption forms
    if (panel.querySelector('#snap-caption-form')) return;
    this.showCaptionForm(panel, (caption) => this.publishSnapshot(panel, canvas, caption));
  }

  /** Inline caption input rendered inside the gallery panel (replaces prompt()). */
  private static showCaptionForm(
    panel: HTMLElement,
    onDone: (caption: string | null) => void
  ): void {
    const form = document.createElement('div');
    form.id = 'snap-caption-form';
    form.style.cssText = `
      display: flex; gap: 8px; align-items: center; margin-bottom: 14px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px; padding: 10px;
    `;

    const input = document.createElement('input');
    input.id = 'snap-caption-input';
    input.type = 'text';
    input.maxLength = 80; // matches server CreateGalleryPhotoSchema caption limit
    input.placeholder = 'Add a caption…';
    input.style.cssText = `
      flex: 1; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px; color: #fff; padding: 8px 12px; font-size: 0.85rem; outline: none;
    `;

    const publishBtn = document.createElement('button');
    publishBtn.textContent = 'Publish 📸';
    publishBtn.style.cssText = `
      background: linear-gradient(135deg, #ec4899 0%, #d946ef 100%);
      border: none; border-radius: 8px; color: #fff; padding: 8px 14px;
      font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px; color: #fff; padding: 8px 12px; font-size: 0.85rem; cursor: pointer;
    `;

    const done = (caption: string | null) => {
      form.remove();
      onDone(caption);
    };

    publishBtn.addEventListener('click', () => done(input.value));
    cancelBtn.addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
    });

    form.appendChild(input);
    form.appendChild(publishBtn);
    form.appendChild(cancelBtn);

    const grid = panel.querySelector('#gallery-photo-grid');
    if (grid) panel.insertBefore(form, grid);
    else panel.appendChild(form);
    input.focus();
  }

  /**
   * Downscale + adaptively compress the snapshot so the data URL stays under
   * ~45KB (safely below the server's 50kb express.json limit). Starts at
   * 640px max dimension / 0.8 JPEG quality, stepping quality down to a 0.4
   * floor, then halving dimensions (240px minimum guard). Returns null if the
   * canvas can't be encoded.
   */
  private static encodeSnapshot(canvas: HTMLCanvasElement): string | null {
    const MAX_DATA_URL_BYTES = 45 * 1024;
    const START_MAX_DIM = 640;
    const MIN_MAX_DIM = 240;
    const START_QUALITY = 0.8;
    const MIN_QUALITY = 0.4;

    let maxDim = START_MAX_DIM;
    let quality = START_QUALITY;
    let dataUrl: string | null = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
      const w = Math.max(1, Math.round(canvas.width * scale));
      const h = Math.max(1, Math.round(canvas.height * scale));

      const thumb = document.createElement('canvas');
      thumb.width = w;
      thumb.height = h;
      const ctx = thumb.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(canvas, 0, 0, w, h);

      try {
        dataUrl = thumb.toDataURL('image/jpeg', quality);
      } catch {
        return null; // e.g. tainted canvas
      }

      const atFloor = quality <= MIN_QUALITY && maxDim <= MIN_MAX_DIM;
      if (dataUrl.length <= MAX_DATA_URL_BYTES || atFloor) break;

      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality - 0.1);
      } else {
        maxDim = Math.floor(maxDim / 2);
      }
    }

    return dataUrl;
  }

  private static async publishSnapshot(
    panel: HTMLElement,
    canvas: HTMLCanvasElement,
    caption: string | null
  ): Promise<void> {
    if (caption === null) {
      showToast({ icon: '🚫', title: 'Snap cancelled', subtitle: 'No photo was taken' });
      return;
    }

    const dataUrl = this.encodeSnapshot(canvas);
    if (!dataUrl) {
      showToast({
        icon: '⚠️',
        title: 'Screenshot capture failed',
        subtitle: 'Could not encode the game canvas',
      });
      return;
    }
    if (dataUrl.length > 45 * 1024) {
      showToast({
        icon: '⚠️',
        title: 'Photo too large',
        subtitle: 'Even compressed, the snapshot exceeds the upload limit',
      });
      return;
    }

    try {
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
        showToast({
          icon: '📸',
          title: 'Photo published!',
          subtitle: caption.trim() || 'Shared to the Haven Gallery',
        });
        await this.loadPhotos(panel);
      } else {
        const message = await this.readErrorMessage(res);
        showToast({ icon: '⚠️', title: 'Photo upload failed', subtitle: message });
      }
    } catch (err: any) {
      showToast({
        icon: '⚠️',
        title: 'Photo upload failed',
        subtitle: err?.message || 'Network error',
      });
    }
  }

  /** Read a human-friendly message from an error response (JSON or plain text). */
  private static async readErrorMessage(res: Response): Promise<string> {
    try {
      const text = await res.text();
      if (!text) return `Server responded ${res.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.error === 'string') return parsed.error;
      } catch {
        /* not JSON */
      }
      return text.length > 140 ? text.slice(0, 140) + '…' : text;
    } catch {
      return `Server responded ${res.status}`;
    }
  }

  static dismiss(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
