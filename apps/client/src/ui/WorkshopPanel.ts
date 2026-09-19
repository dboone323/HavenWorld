import { socketService } from '../services/socket';
import { SOCKET_EVENTS, type CraftingRecipe } from '@havenworld/shared';
import { API_URL } from '../config';
import { authService } from '../services/auth';

export class WorkshopPanel {
  private static overlay: HTMLElement | null = null;

  static async show(): Promise<void> {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.id = 'workshop-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1c1a2e; border: 1px solid rgba(255,255,255,0.18);
      border-radius: 16px; width: 500px; max-height: 85vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
        <h2 style="margin:0; font-size:1.3rem;">🔨 Crafting Workshop</h2>
        <button id="workshop-panel-close" style="background:none; border:none; color:#aaa; font-size:1.4rem; cursor:pointer;">✕</button>
      </div>

      <div id="workshop-materials-bar" style="
        display:flex; gap:12px; background:rgba(255,255,255,0.06);
        padding:12px; border-radius:10px; margin-bottom:20px; font-size:0.85rem;
      ">
        <span>🪵 Timber: <b id="mat-timber">0</b></span>
        <span>⚙️ Scrap Metal: <b id="mat-metal">0</b></span>
        <span>🧵 Fabric: <b id="mat-fabric">0</b></span>
        <span>💎 Crystal: <b id="mat-crystal">0</b></span>
      </div>

      <div id="workshop-recipes-list" style="display:flex; flex-direction:column; gap:12px;">
        <p style="color:rgba(255,255,255,0.6); font-size:0.9rem;">Loading recipes...</p>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.querySelector('#workshop-panel-close')?.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });

    await this.loadData(panel);
  }

  private static async loadData(panel: HTMLElement): Promise<void> {
    const token = authService.token || (await authService.getToken());
    if (!token) return;

    try {
      const [resRec, resMat] = await Promise.all([
        fetch(`${API_URL}/workshop/recipes`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/workshop/materials`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (resMat.ok) {
        const matData = await resMat.json();
        const mats = matData.materials || {};
        const tEl = panel.querySelector('#mat-timber');
        const mEl = panel.querySelector('#mat-metal');
        const fEl = panel.querySelector('#mat-fabric');
        const cEl = panel.querySelector('#mat-crystal');
        if (tEl) tEl.textContent = String(mats.timber || 0);
        if (mEl) mEl.textContent = String(mats.scrapMetal || 0);
        if (fEl) fEl.textContent = String(mats.fabric || 0);
        if (cEl) cEl.textContent = String(mats.crystalShard || 0);
      }

      if (resRec.ok) {
        const recipes: CraftingRecipe[] = await resRec.json();
        const listEl = panel.querySelector('#workshop-recipes-list');
        if (listEl) {
          listEl.innerHTML = '';
          for (const rec of recipes) {
            const row = document.createElement('div');
            row.style.cssText = `
              background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
              border-radius: 10px; padding: 12px; display: flex; justify-content: space-between;
              align-items: center;
            `;

            const costStr = rec.materials
              .map((m) => `${m.qty}x ${m.type}`)
              .join(', ');

            row.innerHTML = `
              <div>
                <div style="font-weight:600; font-size:0.95rem;">${rec.name}</div>
                <div style="font-size:0.8rem; color:rgba(255,255,255,0.6); margin-top:2px;">
                  Requires: ${costStr} (⏱️ ${rec.craftingMinutes || 15}m)
                </div>
              </div>
              <button class="btn-craft-recipe" data-recipe-id="${rec.id}" style="
                background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                border: none; border-radius: 8px; color: #fff; padding: 8px 16px;
                font-size: 0.85rem; font-weight: 600; cursor: pointer;
              ">Craft</button>
            `;

            row.querySelector('.btn-craft-recipe')?.addEventListener('click', () => {
              socketService.emit(SOCKET_EVENTS.START_CRAFT, { recipeId: rec.id });
              alert(`Started crafting ${rec.name}!`);
            });

            listEl.appendChild(row);
          }
        }
      }
    } catch (err) {
      console.error('[WorkshopPanel] Error loading workshop data:', err);
    }
  }

  static dismiss(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
