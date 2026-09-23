import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { escapeHtml } from '../utils/escapeHtml';

interface GuestbookEntry {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  message: string;
  createdAt: string;
}

interface GuestbookPage {
  entries: GuestbookEntry[];
  page: number;
  totalPages: number;
  totalEntries: number;
}

/** Avatar color is injected into an inline style — allow only hex colors. */
function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : '#4ecdc4';
}

/**
 * In-room guestbook UI (the server socket API existed without any client).
 * Data arrives over sockets: GUESTBOOK_PAGE (requested via GET_GUESTBOOK) and
 * GUESTBOOK_SIGNED (broadcast to room occupants after someone signs).
 */
export class GuestbookPanel {
  private static overlay: HTMLElement | null = null;
  private static roomId: string | null = null;
  private static canDelete = false;
  private static currentPage = 1;
  private static totalPages = 1;
  private static unsubs: Array<() => void> = [];

  static show(roomId: string, opts: { canDelete?: boolean } = {}): void {
    this.dismiss();

    this.roomId = roomId;
    this.canDelete = Boolean(opts.canDelete);
    this.currentPage = 1;
    this.totalPages = 1;

    const overlay = document.createElement('div');
    overlay.id = 'guestbook-panel-overlay';
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
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0; font-size:1.3rem;">📖 Guestbook</h2>
        <button id="guestbook-close" style="background:none; border:none; color:#aaa; font-size:1.4rem; cursor:pointer;">✕</button>
      </div>

      <div id="guestbook-list" style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
        <p style="color:rgba(255,255,255,0.6); font-size:0.85rem;">Loading entries...</p>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <button id="guestbook-prev" style="background:rgba(255,255,255,0.1); border:none; border-radius:8px; color:#fff; padding:6px 12px; cursor:pointer;">← Prev</button>
        <span id="guestbook-page-label" style="font-size:0.8rem; color:rgba(255,255,255,0.6);">Page 1</span>
        <button id="guestbook-next" style="background:rgba(255,255,255,0.1); border:none; border-radius:8px; color:#fff; padding:6px 12px; cursor:pointer;">Next →</button>
      </div>

      <div style="display:flex; gap:8px;">
        <textarea id="guestbook-input" rows="2" maxlength="120" placeholder="Leave a friendly note (120 chars max)" style="
          flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
          border-radius:8px; color:#fff; padding:8px 12px; font-size:0.9rem; resize:none;
        "></textarea>
        <button id="guestbook-sign" style="
          background:linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          border:none; border-radius:8px; color:#fff; padding:10px 16px; font-weight:600; cursor:pointer;
        ">Sign</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.querySelector('#guestbook-close')?.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });

    panel.querySelector('#guestbook-prev')?.addEventListener('click', () => {
      this.requestPage(Math.max(1, this.currentPage - 1));
    });
    panel.querySelector('#guestbook-next')?.addEventListener('click', () => {
      this.requestPage(Math.min(this.totalPages, this.currentPage + 1));
    });

    panel.querySelector('#guestbook-sign')?.addEventListener('click', () => {
      const input = panel.querySelector('#guestbook-input') as HTMLTextAreaElement | null;
      const message = input?.value.trim() ?? '';
      if (!message || !this.roomId) return;
      socketService.emit(SOCKET_EVENTS.SIGN_GUESTBOOK, { roomId: this.roomId, message });
      if (input) input.value = '';
    });

    this.unsubs.push(
      socketService.on<GuestbookPage>(SOCKET_EVENTS.GUESTBOOK_PAGE, (page) =>
        this.renderPage(page)
      ),
      socketService.on<{ entry: GuestbookEntry }>(SOCKET_EVENTS.GUESTBOOK_SIGNED, (data) => {
        if (data?.entry?.roomId === this.roomId) {
          this.requestPage(this.currentPage);
        }
      })
    );

    this.requestPage(1);
  }

  private static requestPage(page: number): void {
    if (!this.roomId) return;
    this.currentPage = page;
    socketService.emit(SOCKET_EVENTS.GET_GUESTBOOK, { roomId: this.roomId, page });
  }

  private static renderPage(pageData: GuestbookPage): void {
    if (!this.overlay) return;
    this.currentPage = pageData.page ?? 1;
    this.totalPages = pageData.totalPages ?? 1;

    const list = this.overlay.querySelector('#guestbook-list');
    if (list) {
      if (!pageData.entries?.length) {
        list.innerHTML =
          '<p style="color:rgba(255,255,255,0.55); font-size:0.85rem; font-style:italic;">No entries yet — be the first to sign!</p>';
      } else {
        list.innerHTML = pageData.entries
          .map((entry) => {
            const deleteBtn = this.canDelete
              ? `<button class="guestbook-delete" data-entry-id="${escapeHtml(entry.id)}" style="background:none; border:none; color:#ff6b81; font-size:0.75rem; cursor:pointer; padding:0;">Delete</button>`
              : '';
            return `
            <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:10px 12px;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="width:18px; height:18px; border-radius:50%; background:${safeColor(entry.authorAvatar)}; display:inline-block;"></span>
                  <b style="font-size:0.85rem;">${escapeHtml(entry.authorName)}</b>
                </div>
                ${deleteBtn}
              </div>
              <div style="font-size:0.9rem; color:rgba(255,255,255,0.85); white-space:pre-wrap; word-break:break-word;">${escapeHtml(entry.message)}</div>
              <div style="font-size:0.7rem; color:rgba(255,255,255,0.45); margin-top:4px;">${escapeHtml(this.formatDate(entry.createdAt))}</div>
            </div>`;
          })
          .join('');
      }
    }

    const label = this.overlay.querySelector('#guestbook-page-label');
    if (label) label.textContent = `Page ${this.currentPage} / ${this.totalPages}`;

    const prev = this.overlay.querySelector('#guestbook-prev') as HTMLButtonElement | null;
    const next = this.overlay.querySelector('#guestbook-next') as HTMLButtonElement | null;
    if (prev) prev.disabled = this.currentPage <= 1;
    if (next) next.disabled = this.currentPage >= this.totalPages;

    this.overlay.querySelectorAll<HTMLButtonElement>('.guestbook-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entryId = btn.dataset.entryId;
        if (!entryId) return;
        socketService.emit(SOCKET_EVENTS.DELETE_GUESTBOOK_ENTRY, { entryId });
        // The server does not broadcast deletions — refresh the current page.
        this.requestPage(this.currentPage);
      });
    });
  }

  private static formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  static dismiss(): void {
    for (const unsub of this.unsubs) {
      try {
        unsub();
      } catch {
        /* listener already detached */
      }
    }
    this.unsubs = [];
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.roomId = null;
  }
}
