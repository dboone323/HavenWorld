import type { AvatarData } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/events';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';

type Category = 'hair' | 'eyes' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory';

const CATEGORIES: Category[] = ['hair', 'eyes', 'top', 'bottom', 'shoes', 'hat', 'accessory'];

// Placeholder inventory — in production, fetched from /api/users/me/inventory
const DEMO_INVENTORY: Record<Category, string[]> = {
  hair:      ['hair-01', 'hair-02', 'hair-03', 'hair-04'],
  eyes:      ['eyes-01', 'eyes-02', 'eyes-03'],
  top:       ['top-01', 'top-02', 'top-03', 'top-04', 'top-05'],
  bottom:    ['bottom-01', 'bottom-02', 'bottom-03'],
  shoes:     ['shoes-01', 'shoes-02'],
  hat:       ['hat-01', 'hat-02', 'hat-none'],
  accessory: ['acc-01', 'acc-none'],
};

/**
 * AvatarCustomizer — 7-tab wardrobe UI mounted inside #avatar-panel.
 */
export class AvatarCustomizer {
  private panel:   HTMLElement;
  private current: AvatarData;
  private draft:   AvatarData;
  private activeCategory: Category = 'hair';

  constructor(panel: HTMLElement) {
    this.panel   = panel;
    this.current = { ...authService.user!.avatar };
    this.draft   = { ...this.current };
    this.render();
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  private render(): void {
    this.panel.innerHTML = `
      <div class="customizer">
        <div class="customizer__tabs" id="customizer-tabs"></div>
        <div class="customizer__grid" id="customizer-grid"></div>
        <div class="customizer__actions">
          <button class="btn btn--ghost" id="cust-cancel">Cancel</button>
          <button class="btn btn--teal"  id="cust-save">Save</button>
        </div>
      </div>
    `;

    this.renderTabs();
    this.renderGrid(this.activeCategory);

    document.getElementById('cust-cancel')?.addEventListener('click', () => {
      this.draft = { ...this.current };
      this.panel.classList.add('hidden');
    });

    document.getElementById('cust-save')?.addEventListener('click', () => {
      this.save().catch(console.error);
    });
  }

  private renderTabs(): void {
    const container = document.getElementById('customizer-tabs')!;
    container.innerHTML = '';

    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = `customizer__tab${cat === this.activeCategory ? ' customizer__tab--active' : ''}`;
      btn.textContent = cap(cat);
      btn.addEventListener('click', () => {
        this.activeCategory = cat;
        this.renderTabs();
        this.renderGrid(cat);
      });
      container.appendChild(btn);
    }
  }

  private renderGrid(category: Category): void {
    const grid = document.getElementById('customizer-grid')!;
    grid.innerHTML = '';

    const items = DEMO_INVENTORY[category];
    const equipped = this.draft[category];

    for (const item of items) {
      const tile = document.createElement('div');
      tile.className = `customizer__item${item === equipped ? ' equipped' : ''}`;
      tile.setAttribute('title', item);

      // Preview image (atlas frame rendered to canvas thumbnail)
      const label = document.createElement('span');
      label.className = 'customizer__item-label';
      label.textContent = item;
      tile.appendChild(label);

      tile.addEventListener('click', () => {
        this.tryOn(category, item);
        grid.querySelectorAll('.customizer__item').forEach(el => el.classList.remove('equipped'));
        tile.classList.add('equipped');
      });

      grid.appendChild(tile);
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  private tryOn(category: Category, item: string): void {
    (this.draft as Record<string, string>)[category] = item;

    // Broadcast live preview to room (AVATAR_UPDATE, no persist)
    socketService.emit(SOCKET_EVENTS.AVATAR_UPDATE, {
      ...this.draft,
    });

    // Update local user preview
    authService.updateAvatar({ ...this.draft });
  }

  private async save(): Promise<void> {
    try {
      const res = await fetch('/api/users/me/avatar', {
        method:  'PUT',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${authService.token ?? ''}`,
        },
        body: JSON.stringify(this.draft),
      });

      if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`);

      this.current = { ...this.draft };
      authService.updateAvatar({ ...this.current });

      // Broadcast saved avatar to room
      socketService.emit(SOCKET_EVENTS.AVATAR_UPDATE, { ...this.current });

      this.panel.classList.add('hidden');
    } catch (err) {
      console.error('[AvatarCustomizer] Save error:', err);
    }
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  open(): void {
    this.draft = { ...authService.user!.avatar };
    this.render();
    this.panel.classList.remove('hidden');
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
