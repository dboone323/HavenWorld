import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface LoftListing {
  id: string;
  roomId: string;
  sellerId: string;
  itemId: string;
  priceCoins: number;
}

interface PurchaseReceipt {
  success?: boolean;
  itemId?: string;
  priceCoins?: number;
}

/**
 * Loft shop cash register (roadmap §3n). The owner stocks items from their
 * inventory; guests browse and buy. All transfers run server-side through
 * LoftShopService; live listings arrive on LOFT_SHOP_LISTING broadcasts and
 * the full set on LOFT_SHOP_LISTINGS (reply to LOFT_SHOP_LIST).
 */
export class LoftShopModal {
  private static overlay: HTMLElement | null = null;
  private static unsubs: Array<() => void> = [];
  private static listings: LoftListing[] = [];

  static show(roomId: string, isOwner: boolean): void {
    this.dismiss();
    this.listings = [];

    const overlay = document.createElement('div');
    overlay.id = 'loft-shop-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#1b1b36; border:1px solid rgba(201,162,39,0.5); border-radius:16px;
      color:#fff; width:min(500px, calc(100vw - 32px)); max-height:84vh; overflow-y:auto;
      padding:22px; box-shadow:0 12px 48px rgba(0,0,0,0.6);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const redraw = () => { if (this.overlay) this.render(panel, roomId, isOwner); };

    this.unsubs.push(
      socketService.on<LoftListing[]>(SOCKET_EVENTS.LOFT_SHOP_LISTINGS, (list) => {
        this.listings = list;
        redraw();
      }),
      socketService.on<LoftListing>(SOCKET_EVENTS.LOFT_SHOP_LISTING, (listing) => {
        this.listings = [listing, ...this.listings.filter((l) => l.id !== listing.id)];
        redraw();
      }),
      socketService.on<PurchaseReceipt>(SOCKET_EVENTS.LOFT_SHOP_RESULT, (receipt) => {
        showToast({
          icon: '🧾',
          title: 'Purchase complete!',
          subtitle: `${receipt.itemId ?? 'Item'} delivered — thanks for shopping`,
        });
        socketService.emit(SOCKET_EVENTS.LOFT_SHOP_LIST, { roomId });
      }),
      socketService.on<{ code: string; message?: string }>(SOCKET_EVENTS.ERROR, (err) => {
        if (err.code === 'SHOP_ERROR' || err.code === 'INVALID_ITEMS') {
          showToast({ icon: '⚠️', title: 'Loft shop', subtitle: err.message ?? 'Transaction failed' });
        }
      })
    );

    redraw();
    socketService.emit(SOCKET_EVENTS.LOFT_SHOP_LIST, { roomId });
  }

  private static render(panel: HTMLElement, roomId: string, isOwner: boolean): void {
    const rows = this.listings.length === 0
      ? `<p style="font-size:13px;opacity:0.65">${isOwner ? 'Your register is empty. Stock an item below to sell to visitors!' : 'This register has nothing in stock yet.'}</p>`
      : this.listings.map((l) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;
            background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px">
            <span style="flex:1;font-size:14px"><strong>${escapeHtml(l.itemId)}</strong></span>
            <span style="font-size:14px;color:#f0ad4e">🪙 ${l.priceCoins.toLocaleString()}</span>
            ${isOwner ? '' : `<button data-buy="${l.id}" style="padding:6px 12px;border-radius:8px;border:none;background:#4ecdc4;color:#12122b;font-weight:600;cursor:pointer;font-size:12px">Buy</button>`}
          </div>`).join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0;font-size:18px">🧾 ${isOwner ? 'Your Shop Register' : 'Loft Shop'}</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      ${rows}
      ${isOwner ? `
        <div style="display:flex;gap:8px;margin-top:12px">
          <input id="shop-item" placeholder="Item ID from inventory" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff"/>
          <input id="shop-price" type="number" min="1" placeholder="Price 🪙" style="width:100px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff"/>
          <button data-action="stock" style="padding:8px 14px;border-radius:8px;border:none;background:#f0ad4e;color:#12122b;font-weight:600;cursor:pointer">Stock</button>
        </div>
        <p style="font-size:12px;opacity:0.6;margin-top:8px">Items move into the register escrow until a guest buys them.</p>` : ''}
    `;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        socketService.emit(SOCKET_EVENTS.LOFT_SHOP_PURCHASE, { listingId: btn.dataset.buy });
      });
    });
    panel.querySelector('[data-action="stock"]')?.addEventListener('click', () => {
      const itemId = (panel.querySelector('#shop-item') as HTMLInputElement).value.trim();
      const priceCoins = parseInt((panel.querySelector('#shop-price') as HTMLInputElement).value, 10);
      if (!itemId || !Number.isInteger(priceCoins) || priceCoins <= 0) {
        showToast({ icon: '⚠️', title: 'Loft shop', subtitle: 'Enter an item ID and a positive price' });
        return;
      }
      socketService.emit(SOCKET_EVENTS.LOFT_SHOP_STOCK, { roomId, itemId, priceCoins });
      showToast({ icon: '🏷️', title: 'Stocking…', subtitle: itemId });
    });
  }

  static dismiss(): void {
    this.unsubs.forEach((off) => off());
    this.unsubs = [];
    this.overlay?.remove();
    this.overlay = null;
  }
}
