import { socketService } from '../services/socket';
import { SOCKET_EVENTS, TradeStateData, TradeOfferItem } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';
import { showToast } from './ToastNotification';
import { authService } from '../services/auth';
import { SERVER_URL } from '../config';

interface InventoryItem {
  id: string;
  itemId: string;
  name: string;
  category: string;
  isTradeable: boolean;
  assetUrl?: string;
  spriteKey?: string;
  quantity: number;
}

export class TradeModal {
  private overlay: HTMLElement | null = null;
  private promptOverlay: HTMLElement | null = null;
  private currentTrade: TradeStateData | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private myInventory: InventoryItem[] = [];

  constructor() {
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    // 1. Receiver-side trade invitation
    socketService.on<{ tradeId: string; initiatorId: string; initiatorName: string }>(
      SOCKET_EVENTS.TRADE_REQUESTED,
      (data) => {
        this.showIncomingPrompt(data.initiatorName);
      }
    );

    // 2. Real-time trade state updates
    socketService.on<TradeStateData>(SOCKET_EVENTS.TRADE_STATE_UPDATE, (state) => {
      this.currentTrade = state;
      this.dismissPrompt();
      if (!this.overlay) {
        this.open();
      } else {
        this.updateUI();
      }
    });

    // 3. Trade countdown
    socketService.on<{ seconds: number }>(SOCKET_EVENTS.TRADE_COUNTDOWN, (data) => {
      const timerEl = document.getElementById('trade-countdown-timer');
      if (timerEl) {
        timerEl.textContent = `Confirming Swap: ${data.seconds}s`;
        timerEl.style.color = '#eab308';
      }
    });

    // 4. Trade completion
    socketService.on(SOCKET_EVENTS.TRADE_COMPLETE, (data: { summary: string }) => {
      audioEngine.playTradeComplete();
      showToast({ icon: '🤝', title: 'Trade Successful!', subtitle: data.summary || 'Swap complete.' });
      this.close();
    });

    // 5. Trade cancellation
    socketService.on(SOCKET_EVENTS.TRADE_CANCELLED, (data: { reason: string }) => {
      showToast({ icon: '❌', title: 'Trade Cancelled', subtitle: data.reason || 'Trade ended.' });
      this.close();
    });

    // 6. Generic errors
    socketService.on<{ message?: string }>(SOCKET_EVENTS.ERROR, (err) => {
      if (this.overlay && err?.message) {
        showToast({ icon: '⚠️', title: 'Trade Notice', subtitle: err.message });
      }
    });
  }

  private showIncomingPrompt(initiatorName: string): void {
    this.dismissPrompt();

    const prompt = document.createElement('div');
    prompt.id = 'trade-incoming-prompt';
    prompt.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      background: #1a1a2e;
      border: 2px solid #4ecdc4;
      border-radius: 12px;
      padding: 16px 20px;
      color: #fff;
      z-index: 10001;
      font-family: Calibri, sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: modalFadeIn 0.2s ease-out;
      min-width: 280px;
    `;

    prompt.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.3rem;">🤝</span>
        <div>
          <div style="font-weight: 700; color: #4ecdc4;">Trade Request</div>
          <div style="font-size: 0.85rem; color: #cbd5e1;">${initiatorName} wants to trade with you.</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="btn-trade-accept-req" style="background: #22c55e; color: #000; border: none; border-radius: 6px; padding: 6px 14px; font-weight: bold; cursor: pointer;">Accept</button>
        <button id="btn-trade-decline-req" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; border-radius: 6px; padding: 6px 12px; cursor: pointer;">Decline</button>
      </div>
    `;

    document.body.appendChild(prompt);
    this.promptOverlay = prompt;

    prompt.querySelector('#btn-trade-accept-req')?.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.TRADE_ACCEPT, {});
      this.dismissPrompt();
    });

    prompt.querySelector('#btn-trade-decline-req')?.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.TRADE_DECLINE, {});
      this.dismissPrompt();
    });
  }

  private dismissPrompt(): void {
    if (this.promptOverlay) {
      this.promptOverlay.remove();
      this.promptOverlay = null;
    }
  }

  async open(): Promise<void> {
    if (this.overlay) return;
    await this.loadInventory();
    this.render();
  }

  close(): void {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.overlay?.remove();
    this.overlay = null;
    this.currentTrade = null;
    this.dismissPrompt();
  }

  private async loadInventory(): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/users/me/inventory`, {
        headers: { Authorization: `Bearer ${authService.token || ''}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const equippedIds = new Set<string>();
      const avatar = (authService.user?.avatar || {}) as Record<string, string | undefined>;
      for (const slot of ['outfitHead', 'outfitFace', 'outfitBody', 'outfitLegs', 'outfitFeet', 'outfitBack', 'outfitHand']) {
        const val = avatar[slot];
        if (typeof val === 'string' && val) equippedIds.add(val);
      }

      this.myInventory = (data || []).filter((item: any) => {
        // Enforce isTradeable and exclude equipped items
        return item.isTradeable === true && !equippedIds.has(item.itemId);
      });
    } catch {
      this.myInventory = [];
    }
  }

  private render(): void {
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'trade-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e;
      border: 2px solid #4ecdc4;
      border-radius: 14px;
      width: min(720px, 95vw);
      max-height: 90vh;
      overflow-y: auto;
      padding: 22px;
      color: #e2e8f0;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85);
      display: flex;
      flex-direction: column;
      gap: 16px;
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.3rem;">🤝</span>
          <h3 style="margin: 0; color: #4ecdc4;">Secure Player Trade (6 Slots)</h3>
        </div>
        <span id="trade-countdown-timer" style="font-size: 0.95rem; font-weight: bold; color: #888;"></span>
      </div>

      <!-- Trade Grid: My Offer vs Their Offer -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <!-- My Offer -->
        <div id="panel-my-offer" style="background: #16213e; border: 2px solid #333; border-radius: 10px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-weight: bold; color: #4ecdc4;">My Offer</div>
            <span id="badge-my-ready" style="font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: #334155; color: #cbd5e1;">NOT READY</span>
          </div>
          <div id="my-trade-slots" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            ${[0, 1, 2, 3, 4, 5].map((i) => `
              <div class="trade-slot trade-slot--mine" data-slot="${i}" style="height: 64px; background: #0f172a; border: 1px dashed #475569; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.72rem; color: #64748b; cursor: pointer; text-align: center; padding: 4px; overflow: hidden;">
                <span>Empty</span>
              </div>
            `).join('')}
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 0.85rem;">🪙 Coins:</label>
            <input id="trade-my-coins" type="number" min="0" max="9999" value="0" style="width: 90px; padding: 4px 8px; background: #0f172a; border: 1px solid #475569; color: #ffd700; border-radius: 4px;" />
          </div>
        </div>

        <!-- Their Offer -->
        <div id="panel-their-offer" style="background: #16213e; border: 2px solid #333; border-radius: 10px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div id="label-their-offer" style="font-weight: bold; color: #38bdf8;">Their Offer</div>
            <span id="badge-their-ready" style="font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: #334155; color: #cbd5e1;">NOT READY</span>
          </div>
          <div id="their-trade-slots" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            ${[0, 1, 2, 3, 4, 5].map((i) => `
              <div class="trade-slot" data-slot="${i}" style="height: 64px; background: #0f172a; border: 1px dashed #475569; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.72rem; color: #64748b; text-align: center; padding: 4px; overflow: hidden;">
                <span>Empty</span>
              </div>
            `).join('')}
          </div>
          <div style="font-size: 0.85rem; color: #ffd700;">🪙 Coins: <span id="their-trade-coins">0</span></div>
        </div>
      </div>

      <!-- Inventory Drawer (Tradeable items) -->
      <div style="background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.85rem; font-weight: 600; color: #9ca3af; margin-bottom: 8px; display: flex; justify-content: space-between;">
          <span>📦 Click an item to add to your offer (Tradeable Only):</span>
          <span style="font-size: 0.75rem;">${this.myInventory.length} tradeable items</span>
        </div>
        <div id="trade-inventory-shelf" style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px;">
          ${this.myInventory.length === 0 ? '<div style="color:#6b7280; font-size:0.8rem; padding:8px;">No tradeable items in inventory.</div>' : ''}
          ${this.myInventory.map((item) => `
            <div class="inventory-trade-chip" data-item-id="${item.itemId}" data-name="${item.name}" style="background: #1f2937; border: 1px solid #4b5563; border-radius: 6px; padding: 6px 10px; cursor: pointer; display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 0.8rem; transition: background 0.15s;">
              <span>🎁</span>
              <span>${item.name}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Controls -->
      <div style="display: flex; gap: 12px; justify-content: flex-end; align-items: center;">
        <button id="btn-trade-ready" style="background: #4ecdc4; color: #000; border: none; padding: 9px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: opacity 0.15s;">Ready</button>
        <button id="btn-trade-confirm" style="background: #22c55e; color: #000; border: none; padding: 9px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; display: none;">Confirm Swap</button>
        <button id="btn-trade-cancel" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 9px 18px; border-radius: 6px; cursor: pointer;">Cancel Trade</button>
      </div>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    // Click inventory chip -> offer item in first empty slot
    panel.querySelectorAll('.inventory-trade-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const itemId = chip.getAttribute('data-item-id');
        const name = chip.getAttribute('data-name') || '';
        if (!itemId) return;
        this.addOfferItem(itemId, name);
      });
    });

    // Click my offer slot -> remove item from slot
    panel.querySelectorAll('.trade-slot--mine').forEach((slotEl) => {
      slotEl.addEventListener('click', () => {
        const slotIdx = parseInt(slotEl.getAttribute('data-slot') || '0', 10);
        this.removeOfferItem(slotIdx);
      });
    });

    panel.querySelector('#btn-trade-ready')?.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.TRADE_READY, {});
      const btn = panel.querySelector('#btn-trade-ready') as HTMLButtonElement;
      if (btn) btn.style.opacity = '0.5';
    });

    panel.querySelector('#btn-trade-confirm')?.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.TRADE_CONFIRM, {});
    });

    panel.querySelector('#btn-trade-cancel')?.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.TRADE_CANCEL, {});
      this.close();
    });

    panel.querySelector('#trade-my-coins')?.addEventListener('change', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10) || 0;
      socketService.emit(SOCKET_EVENTS.OFFER_COINS, { amount: val });
    });

    this.updateUI();
  }

  private addOfferItem(itemId: string, name: string): void {
    if (!this.currentTrade) return;
    const isInitiator = this.currentTrade.initiatorId === authService.user?.id;
    const myItems = isInitiator ? this.currentTrade.initiatorItems : this.currentTrade.receiverItems;

    // Find lowest available slot 0..5
    const occupied = new Set(myItems.map((i) => i.slotIndex));
    let targetSlot = -1;
    for (let s = 0; s < 6; s++) {
      if (!occupied.has(s)) {
        targetSlot = s;
        break;
      }
    }

    if (targetSlot === -1) {
      showToast({ icon: '⚠️', title: 'Offer Full', subtitle: 'All 6 trade slots are occupied.' });
      return;
    }

    socketService.emit(SOCKET_EVENTS.OFFER_ITEM, {
      slotIndex: targetSlot,
      inventoryItemId: itemId,
      name,
    });
  }

  private removeOfferItem(slotIndex: number): void {
    socketService.emit(SOCKET_EVENTS.OFFER_ITEM, {
      slotIndex,
      inventoryItemId: '',
      name: '',
    });
  }

  private updateUI(): void {
    if (!this.currentTrade || !this.overlay) return;

    const isInitiator = this.currentTrade.initiatorId === authService.user?.id;
    const myItems = isInitiator ? this.currentTrade.initiatorItems : this.currentTrade.receiverItems;
    const theirItems = isInitiator ? this.currentTrade.receiverItems : this.currentTrade.initiatorItems;
    const myReady = isInitiator ? this.currentTrade.initiatorReady : this.currentTrade.receiverReady;
    const theirReady = isInitiator ? this.currentTrade.receiverReady : this.currentTrade.initiatorReady;
    const myCoins = isInitiator ? this.currentTrade.initiatorCoins : this.currentTrade.receiverCoins;
    const theirCoins = isInitiator ? this.currentTrade.receiverCoins : this.currentTrade.initiatorCoins;

    // Update My Slots
    const mySlotMap = new Map<number, TradeOfferItem>();
    for (const item of myItems) mySlotMap.set(item.slotIndex, item);

    this.overlay.querySelectorAll('#my-trade-slots .trade-slot').forEach((slotEl) => {
      const idx = parseInt(slotEl.getAttribute('data-slot') || '0', 10);
      const item = mySlotMap.get(idx);
      if (item) {
        slotEl.innerHTML = `<span style="font-size:1.1rem;">🎁</span><strong style="color:#4ecdc4;">${item.name}</strong><span style="font-size:0.65rem; color:#ef4444;">(click to remove)</span>`;
        (slotEl as HTMLElement).style.borderColor = '#4ecdc4';
        (slotEl as HTMLElement).style.background = '#1e293b';
      } else {
        slotEl.innerHTML = `<span>Empty</span>`;
        (slotEl as HTMLElement).style.borderColor = '#475569';
        (slotEl as HTMLElement).style.background = '#0f172a';
      }
    });

    // Update Their Slots
    const theirSlotMap = new Map<number, TradeOfferItem>();
    for (const item of theirItems) theirSlotMap.set(item.slotIndex, item);

    this.overlay.querySelectorAll('#their-trade-slots .trade-slot').forEach((slotEl) => {
      const idx = parseInt(slotEl.getAttribute('data-slot') || '0', 10);
      const item = theirSlotMap.get(idx);
      if (item) {
        slotEl.innerHTML = `<span style="font-size:1.1rem;">🎁</span><strong style="color:#38bdf8;">${item.name}</strong>`;
        (slotEl as HTMLElement).style.borderColor = '#38bdf8';
        (slotEl as HTMLElement).style.background = '#1e293b';
      } else {
        slotEl.innerHTML = `<span>Empty</span>`;
        (slotEl as HTMLElement).style.borderColor = '#475569';
        (slotEl as HTMLElement).style.background = '#0f172a';
      }
    });

    // Update coins
    const theirCoinsEl = this.overlay.querySelector('#their-trade-coins');
    if (theirCoinsEl) theirCoinsEl.textContent = String(theirCoins);

    const myCoinsInput = this.overlay.querySelector('#trade-my-coins') as HTMLInputElement;
    if (myCoinsInput && document.activeElement !== myCoinsInput) {
      myCoinsInput.value = String(myCoins);
    }

    // Update Ready Badges & Panels
    const myBadge = this.overlay.querySelector('#badge-my-ready') as HTMLElement;
    if (myBadge) {
      myBadge.textContent = myReady ? 'READY' : 'NOT READY';
      myBadge.style.background = myReady ? '#22c55e' : '#334155';
      myBadge.style.color = myReady ? '#000' : '#cbd5e1';
    }

    const theirBadge = this.overlay.querySelector('#badge-their-ready') as HTMLElement;
    if (theirBadge) {
      theirBadge.textContent = theirReady ? 'READY' : 'NOT READY';
      theirBadge.style.background = theirReady ? '#22c55e' : '#334155';
      theirBadge.style.color = theirReady ? '#000' : '#cbd5e1';
    }

    // Buttons
    const confirmBtn = this.overlay.querySelector('#btn-trade-confirm') as HTMLElement;
    const readyBtn = this.overlay.querySelector('#btn-trade-ready') as HTMLElement;

    if (this.currentTrade.state === 'LOCKED') {
      if (confirmBtn) confirmBtn.style.display = 'inline-block';
      if (readyBtn) readyBtn.style.display = 'none';
    } else {
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (readyBtn) {
        readyBtn.style.display = 'inline-block';
        readyBtn.style.opacity = myReady ? '0.6' : '1';
        readyBtn.textContent = myReady ? 'Waiting for partner...' : 'Ready';
      }
    }
  }
}
