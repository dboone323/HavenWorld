import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface MarketListing {
  id: string;
  itemId: string;
  priceCoins: number;
  seller: { id: string; username: string };
  createdAt: string;
}

interface OwnedInventoryEntry {
  id: string;
  itemId: string;
  name?: string;
  quantity: number;
  equipped?: boolean;
}

function formatItemLabel(itemId: string): string {
  return itemId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Player-to-player marketplace panel (roadmap §3a).
 * Browse / list / buy / cancel against GET|POST|DELETE /api/marketplace —
 * escrow and coin transfer are enforced server-side.
 */
export class MarketplacePanel {
  private static overlay: HTMLElement | null = null;
  private static ownedItems: OwnedInventoryEntry[] = [];

  static async open(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'marketplace-panel-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#1b1b36; border:1px solid rgba(255,255,255,0.18); border-radius:16px;
      color:#fff; width:min(560px, calc(100vw - 32px)); max-height:86vh; overflow-y:auto;
      padding:22px; box-shadow:0 12px 48px rgba(0,0,0,0.6);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    this.render(panel, null);
    const [data, invRes] = await Promise.all([
      this.request<{ total: number; listings: MarketListing[] }>('GET', '/api/marketplace?limit=30'),
      fetch(`${SERVER_URL}/api/users/me/inventory`, {
        headers: this.authHeaders(),
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (invRes && Array.isArray(invRes.inventory)) {
      this.ownedItems = invRes.inventory.filter((e: OwnedInventoryEntry) => e.quantity > 0 && !e.equipped);
    }
    if (this.overlay) this.render(panel, data);
  }

  private static authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${authService.token ?? ''}` };
  }

  private static async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast({ icon: '⚠️', title: 'Marketplace', subtitle: (data as { error?: string })?.error ?? 'Request failed' });
        return null;
      }
      return data as T;
    } catch {
      showToast({ icon: '⚠️', title: 'Marketplace', subtitle: 'Network error' });
      return null;
    }
  }

  private static render(panel: HTMLElement, data: { total: number; listings: MarketListing[] } | null): void {
    const me = authService.user?.id;
    const rows = !data || data.listings.length === 0
      ? '<p style="font-size:13px;opacity:0.65">No active listings. Be the first to sell something!</p>'
      : data.listings.map((l) => {
          const prettyName = formatItemLabel(l.itemId);
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;
            background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px">
            <span style="flex:1;font-size:14px"><strong>${escapeHtml(prettyName)}</strong>
              <span style="display:block;font-size:12px;opacity:0.65">by ${escapeHtml(l.seller.username)}</span></span>
            <span style="font-size:14px;color:#f0ad4e">🪙 ${l.priceCoins.toLocaleString()}</span>
            ${l.seller.id === me
              ? `<button data-cancel="${l.id}" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,107,107,0.6);background:rgba(255,107,107,0.15);color:#fff;cursor:pointer;font-size:12px">Cancel</button>`
              : `<button data-buy="${l.id}" data-buy-price="${l.priceCoins}" data-buy-item="${escapeHtml(prettyName)}"
                  style="padding:6px 12px;border-radius:8px;border:none;background:#4ecdc4;color:#12122b;font-weight:600;cursor:pointer;font-size:12px">Buy</button>`}
          </div>`;
        }).join('');

    const datalistOptions = this.ownedItems
      .map((item) => `<option value="${escapeHtml(item.itemId)}">${escapeHtml(item.name || formatItemLabel(item.itemId))} (x${item.quantity})</option>`)
      .join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0;font-size:18px">🏪 Player Marketplace <span style="font-size:12px;opacity:0.6">${data ? `${data.total} listings` : ''}</span></h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      ${rows}
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-size:14px;color:#4ecdc4">📦 List an item from your inventory</summary>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <input id="mp-item" list="mp-owned-items" placeholder="Select or enter item ID" style="flex:1;min-width:180px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff"/>
          <datalist id="mp-owned-items">${datalistOptions}</datalist>
          <input id="mp-price" type="number" min="1" placeholder="Price 🪙" style="width:110px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff"/>
          <button data-action="list" style="padding:8px 14px;border-radius:8px;border:none;background:#f0ad4e;color:#12122b;font-weight:600;cursor:pointer">List</button>
        </div>
      </details>`;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await this.request('POST', `/api/marketplace/${btn.dataset.buy}/buy`);
        if (ok) {
          showToast({ icon: '🛒', title: 'Purchase complete!', subtitle: `${btn.dataset.buyItem} delivered to inventory` });
        }
        const data2 = await this.request<{ total: number; listings: MarketListing[] }>('GET', '/api/marketplace?limit=30');
        if (this.overlay) this.render(panel, data2);
      });
    });
    panel.querySelectorAll<HTMLElement>('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await this.request('DELETE', `/api/marketplace/${btn.dataset.cancel}`);
        if (ok) {
          showToast({ icon: '📦', title: 'Listing cancelled', subtitle: 'Item returned to your inventory' });
        }
        const data2 = await this.request<{ total: number; listings: MarketListing[] }>('GET', '/api/marketplace?limit=30');
        if (this.overlay) this.render(panel, data2);
      });
    });
    panel.querySelector('[data-action="list"]')?.addEventListener('click', async () => {
      const itemId = (panel.querySelector('#mp-item') as HTMLInputElement).value.trim();
      const priceCoins = parseInt((panel.querySelector('#mp-price') as HTMLInputElement).value, 10);
      if (!itemId || !Number.isInteger(priceCoins) || priceCoins <= 0) {
        showToast({ icon: '⚠️', title: 'Marketplace', subtitle: 'Enter an item ID and a positive price' });
        return;
      }
      const created = await this.request('POST', '/api/marketplace', { itemId, priceCoins });
      if (created) showToast({ icon: '🏷️', title: 'Item listed!', subtitle: `${formatItemLabel(itemId)} for 🪙 ${priceCoins.toLocaleString()}` });
      const data2 = await this.request<{ total: number; listings: MarketListing[] }>('GET', '/api/marketplace?limit=30');
      if (this.overlay) this.render(panel, data2);
    });
  }

  static dismiss(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
