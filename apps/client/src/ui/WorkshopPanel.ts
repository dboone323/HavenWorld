import { socketService } from '../services/socket';
import {
  SOCKET_EVENTS,
  type CraftingRecipe,
  type RawMaterial,
} from '@havenworld/shared';
import { API_URL } from '../config';
import { authService } from '../services/auth';
import { showToast } from './ToastNotification';
import { audioEngine } from '../audio/AudioEngine';

type MaterialStock = {
  timber: number;
  scrapMetal: number;
  fabric: number;
  crystalShard: number;
};

// RawMaterial ('scrap_metal') -> REST/socket key ('scrapMetal')
const RAW_TO_STOCK: Record<RawMaterial, keyof MaterialStock> = {
  timber: 'timber',
  scrap_metal: 'scrapMetal',
  fabric: 'fabric',
  crystal_shard: 'crystalShard',
};

const MATERIAL_LABEL: Record<RawMaterial, string> = {
  timber: 'Timber',
  scrap_metal: 'Scrap Metal',
  fabric: 'Fabric',
  crystal_shard: 'Crystal Shards',
};

interface CraftStartedPayload {
  queueId: string;
  recipeId: string;
  completesAt: string;
}

interface ServerErrorPayload {
  message?: string;
  code?: string;
}

/** How long a craft request may go unanswered before we stop correlating errors to it. */
const PENDING_CRAFT_TIMEOUT_MS = 30_000;

export class WorkshopPanel {
  private static overlay: HTMLElement | null = null;
  private static materials: MaterialStock = {
    timber: 0,
    scrapMetal: 0,
    fabric: 0,
    crystalShard: 0,
  };
  private static recipesById: Map<string, CraftingRecipe> = new Map();
  /** recipeId -> expiry timer for START_CRAFT emits still awaiting a server answer */
  private static pendingCrafts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static unsubscribers: Array<() => void> = [];

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

    this.subscribeToCraftEvents();
    this.renderMaterials(panel);

    await this.loadData(panel);
  }

  /**
   * Subscribe to server craft confirmations, craft errors and material
   * updates. Registered once per panel open; all are removed in dismiss().
   */
  private static subscribeToCraftEvents(): void {
    // Defensive: never double-subscribe if a previous panel leaked them.
    this.unsubscribeCraftEvents();

    // Server confirms a craft started: this is the only place we toast success.
    this.unsubscribers.push(
      socketService.on<CraftStartedPayload>(SOCKET_EVENTS.CRAFT_STARTED, (data) => {
        const timer = this.pendingCrafts.get(data.recipeId);
        if (timer) {
          clearTimeout(timer);
          this.pendingCrafts.delete(data.recipeId);
        }
        const recipe = this.recipesById.get(data.recipeId);
        const name = recipe?.name ?? 'item';
        const minutes = recipe?.craftingMinutes;
        audioEngine.playFurniturePlace();
        showToast({
          icon: '🔨',
          title: 'Crafting started',
          subtitle: `${name}${minutes ? ` · ready in ~${minutes}m` : ''}`,
        });
      })
    );

    // The server routes craft failures (e.g. "Insufficient timber (need 10)")
    // through the generic 'error' event. Only surface one when we have a
    // craft still awaiting an answer, so unrelated errors are untouched.
    this.unsubscribers.push(
      socketService.on<ServerErrorPayload>(SOCKET_EVENTS.ERROR, (data) => {
        if (this.pendingCrafts.size === 0) return;
        const message = typeof data?.message === 'string' ? data.message : '';
        if (!/insufficient|recipe|crafting|material|workshop/i.test(message)) return;
        // Attribute the error to the oldest unanswered craft request.
        const entry = this.pendingCrafts.entries().next().value as
          | [string, ReturnType<typeof setTimeout>]
          | undefined;
        if (!entry) return;
        const [recipeId, timer] = entry;
        clearTimeout(timer);
        this.pendingCrafts.delete(recipeId);
        audioEngine.playError();
        showToast({
          icon: '⚠️',
          title: 'Could not start crafting',
          subtitle: message || 'Not enough materials',
          durationMs: 6000,
        });
      })
    );

    // Keep the material bar (and our deficit checks) in sync with the server.
    this.unsubscribers.push(
      socketService.on<Partial<MaterialStock>>(SOCKET_EVENTS.MATERIALS_UPDATE, (mats) => {
        if (!mats || typeof mats !== 'object') return;
        this.materials = {
          timber: mats.timber ?? this.materials.timber,
          scrapMetal: mats.scrapMetal ?? this.materials.scrapMetal,
          fabric: mats.fabric ?? this.materials.fabric,
          crystalShard: mats.crystalShard ?? this.materials.crystalShard,
        };
        this.renderMaterials();
      })
    );
  }

  private static unsubscribeCraftEvents(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore — a handler may already be gone
      }
    }
    this.unsubscribers = [];
    for (const timer of this.pendingCrafts.values()) clearTimeout(timer);
    this.pendingCrafts.clear();
  }

  /**
   * Client-side deficit check first; the server is the final authority and
   * answers with workshop:craft_started on success or 'error' on failure.
   */
  private static startCraft(recipe: CraftingRecipe): void {
    const shortfall = recipe.materials.find(
      (m) => this.materials[RAW_TO_STOCK[m.type]] < m.qty
    );
    if (shortfall) {
      const have = this.materials[RAW_TO_STOCK[shortfall.type]];
      const need = shortfall.qty - have;
      audioEngine.playError();
      showToast({
        icon: '🪵',
        title: 'Not enough materials',
        subtitle: `Need ${need} more ${MATERIAL_LABEL[shortfall.type]} to craft ${recipe.name}`,
        durationMs: 5000,
      });
      return;
    }

    audioEngine.playClick();
    socketService.emit(SOCKET_EVENTS.START_CRAFT, { recipeId: recipe.id });

    // Do NOT claim success here — wait for the server's workshop:craft_started.
    // Track the request so a matching 'error' can be surfaced as a toast.
    const existing = this.pendingCrafts.get(recipe.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingCrafts.delete(recipe.id);
    }, PENDING_CRAFT_TIMEOUT_MS);
    this.pendingCrafts.set(recipe.id, timer);
  }

  private static renderMaterials(panel: HTMLElement | null = null): void {
    const root = panel ?? this.overlay;
    if (!root) return;
    const set = (id: string, value: number): void => {
      const el = root.querySelector(`#${id}`);
      if (el) el.textContent = String(value);
    };
    set('mat-timber', this.materials.timber);
    set('mat-metal', this.materials.scrapMetal);
    set('mat-fabric', this.materials.fabric);
    set('mat-crystal', this.materials.crystalShard);
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
        this.materials = {
          timber: mats.timber || 0,
          scrapMetal: mats.scrapMetal || 0,
          fabric: mats.fabric || 0,
          crystalShard: mats.crystalShard || 0,
        };
        this.renderMaterials(panel);
      }

      if (resRec.ok) {
        const recipes: CraftingRecipe[] = await resRec.json();
        this.recipesById = new Map(recipes.map((r) => [r.id, r]));
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
              WorkshopPanel.startCraft(rec);
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
    this.unsubscribeCraftEvents();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
