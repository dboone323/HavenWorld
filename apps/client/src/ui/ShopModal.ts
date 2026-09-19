import { authService } from '../services/auth';
import { audioEngine } from '../audio/AudioEngine';
import type { CatalogItem } from '@havenworld/shared';
import { SERVER_URL } from '../config';

export class ShopModal {
  private overlay: HTMLElement | null = null;
  private activeTab: 'featured' | 'permanent' = 'featured';
  private shopData: { featured: CatalogItem[]; permanent: CatalogItem[]; epochRemainingMs: number } | null = null;

  async open(): Promise<void> {
    if (this.overlay) return;
    await this.fetchShopData();
    this.render();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private async fetchShopData(): Promise<void> {
    const token = authService.token || authService.getToken() || '';

    try {
      const res = await fetch(`${SERVER_URL}/api/shop`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        this.shopData = await res.json();
      }
    } catch {
      /* ignore */
    }
  }

  private async buyItem(itemId: string, currency: 'COIN' | 'GEM'): Promise<void> {
    const token = authService.token || authService.getToken() || '';

    try {
      const res = await fetch(`${SERVER_URL}/api/shop/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ itemId, currency }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Purchase failed');
        return;
      }

      audioEngine.playCoinPickup();
      alert(`🎉 Purchased ${data.item.name}! Added to your wardrobe / furniture inventory.`);
    } catch (err: any) {
      alert(err?.message || 'Error processing purchase');
    }
  }

  private render(): void {
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'shop-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
    `;

    const hoursLeft = Math.floor((this.shopData?.epochRemainingMs || 0) / 3_600_000);
    const minsLeft = Math.floor(((this.shopData?.epochRemainingMs || 0) % 3_600_000) / 60_000);

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #ffd700;
      border-radius: 12px;
      width: min(720px, 92vw);
      max-height: 85vh;
      overflow-y: auto;
      padding: 24px;
      color: #e2e8f0;
      box-shadow: 0 8px 32px rgba(255, 215, 0, 0.2);
    `;

    const itemsToDisplay =
      this.activeTab === 'featured'
        ? this.shopData?.featured || []
        : this.shopData?.permanent || [];

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="color: #ffd700; margin: 0; font-size: 1.5rem;">🛍️ Haven Emporium</h2>
        <button id="btn-close-shop" style="background: transparent; border: none; color: #888; font-size: 1.4rem; cursor: pointer;">✕</button>
      </div>

      <!-- Tabs -->
      <div style="display: flex; gap: 12px; margin-bottom: 16px; border-bottom: 1px solid #333; padding-bottom: 8px;">
        <button id="tab-shop-featured" style="background: ${this.activeTab === 'featured' ? '#ffd700' : 'transparent'}; color: ${this.activeTab === 'featured' ? '#000' : '#ccc'}; border: none; padding: 6px 14px; border-radius: 4px; font-weight: bold; cursor: pointer;">
          ✨ Featured (${hoursLeft}h ${minsLeft}m left)
        </button>
        <button id="tab-shop-permanent" style="background: ${this.activeTab === 'permanent' ? '#ffd700' : 'transparent'}; color: ${this.activeTab === 'permanent' ? '#000' : '#ccc'}; border: none; padding: 6px 14px; border-radius: 4px; font-weight: bold; cursor: pointer;">
          📦 Standard Catalog
        </button>
      </div>

      <!-- Items Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
        ${itemsToDisplay
          .map(
            (item) => `
          <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="font-weight: bold; color: #fff; font-size: 1rem;">${item.name}</div>
              <div style="font-size: 0.75rem; color: #888; margin-top: 2px;">${item.rarity} · ${item.category}</div>
              <p style="font-size: 0.85rem; color: #aaa; margin: 8px 0;">${item.description}</p>
            </div>
            <div style="margin-top: 12px;">
              ${
                item.priceCoin > 0
                  ? `<button class="btn-buy-coin" data-id="${item.id}" style="width: 100%; margin-bottom: 6px; background: #eab308; color: #000; border: none; border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer;">🪙 ${item.priceCoin} Coins</button>`
                  : ''
              }
              ${
                item.priceGem > 0
                  ? `<button class="btn-buy-gem" data-id="${item.id}" style="width: 100%; background: #06b6d4; color: #fff; border: none; border-radius: 4px; padding: 6px; font-weight: bold; cursor: pointer;">💎 ${item.priceGem} Gems</button>`
                  : ''
              }
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    panel.querySelector('#btn-close-shop')?.addEventListener('click', () => this.close());
    panel.querySelector('#tab-shop-featured')?.addEventListener('click', () => {
      this.activeTab = 'featured';
      this.render();
    });
    panel.querySelector('#tab-shop-permanent')?.addEventListener('click', () => {
      this.activeTab = 'permanent';
      this.render();
    });

    panel.querySelectorAll('.btn-buy-coin').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id')!;
        this.buyItem(id, 'COIN');
      });
    });

    panel.querySelectorAll('.btn-buy-gem').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id')!;
        this.buyItem(id, 'GEM');
      });
    });
  }
}
