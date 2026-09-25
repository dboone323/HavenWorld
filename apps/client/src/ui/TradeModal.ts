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

  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  private promptInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    // 1. Receiver-side trade invitation
    socketService.on<{ tradeId: string; initiatorId: string; initiatorName: string }>(
      SOCKET_EVENTS.TRADE_REQUESTED,
      (data) => {
        audioEngine.playDoorbell();
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
      audioEngine.playError();
      showToast({ icon: '❌', title: 'Trade Cancelled', subtitle: data.reason || 'Trade ended.' });
      this.close();
    });

    // 6. Generic errors
    socketService.on<{ message?: string }>(SOCKET_EVENTS.ERROR, (err) => {
      if (this.overlay && err?.message) {
        audioEngine.playError();
        showToast({ icon: '⚠️', title: 'Trade Notice', subtitle: err.message });
      }
    });
  }

  private showIncomingPrompt(initiatorName: string): void {
    this.dismissPrompt();

    let timeLeft = 30;
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
          <div style="font-weight: 700; color: #4ecdc4;">Trade Request (<span id="trade-prompt-timer">30</span>s)</div>
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

    this.promptInterval = setInterval(() => {
      timeLeft--;
      const timerEl = document.getElementById('trade-prompt-timer');
      if (timerEl) timerEl.textContent = String(Math.max(0, timeLeft));
      if (timeLeft <= 0) {
        socketService.emit(SOCKET_EVENTS.TRADE_DECLINE, {});
        this.dismissPrompt();
        showToast({ icon: '⏱️', title: 'Trade Expired', subtitle: 'Incoming trade request timed out.' });
      }
    }, 1000);

    prompt.querySelector('#btn-trade-accept-req')?.addEventListener('click', () => {
      audioEngine.playClick();
      socketService.emit(SOCKET_EVENTS.TRADE_ACCEPT, {});
      this.dismissPrompt();
    });

    prompt.querySelector('#btn-trade-decline-req')?.addEventListener('click', () => {
      audioEngine.playClick();
      socketService.emit(SOCKET_EVENTS.TRADE_DECLINE, {});
      this.dismissPrompt();
    });
  }

  private dismissPrompt(): void {
    if (this.promptInterval) {
      clearInterval(this.promptInterval);
      this.promptInterval = null;
    }
    if (this.promptTimer) {
      clearTimeout(this.promptTimer);
      this.promptTimer = null;
    }
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
      background: var(--card-porcelain, rgba(248, 248, 247, 0.985));
      border: 1px solid rgba(40, 48, 56, 0.24);
      border-radius: 18px;
      width: min(840px, 95vw);
      max-height: 90vh;
      overflow-y: auto;
      padding: 24px;
      color: var(--mp-ink, #173044);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
      display: flex;
      flex-direction: column;
      gap: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #dce6ec; padding-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">🤝</span>
          <div>
            <h2 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #173044;">Player Trade</h2>
            <div style="font-size: 0.82rem; color: #597080;">8-slot secure exchange · Both players must confirm</div>
          </div>
        </div>
        <span id="trade-countdown-timer" style="font-size: 0.95rem; font-weight: 800; color: #e5b945;"></span>
      </div>

      <!-- Trade Grid: My Offer vs Their Offer (MiPlanet 2-column comparison) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <!-- My Offer -->
        <div id="panel-my-offer" style="background: #ffffff; border: 1px solid #dce6ec; border-radius: 14px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-weight: 800; font-size: 0.95rem; color: #173044;">Your Offer</div>
            <span id="badge-my-ready" style="font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 8px; background: #e2e8f0; color: #597080;">Reviewing offer</span>
          </div>
          <div id="my-trade-slots" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
            ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `
              <div class="trade-slot trade-slot--mine" data-slot="${i}" style="height: 72px; background: #edf3f7; border: 1px dashed #d6e1e9; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.72rem; color: #768897; cursor: pointer; text-align: center; padding: 4px; overflow: hidden; transition: all 0.15s ease;">
                <span>Empty</span>
              </div>
            `).join('')}
          </div>
          <div style="display: flex; align-items: center; gap: 8px; background: #f8fbff; padding: 8px 10px; border-radius: 8px; border: 1px solid #e2eaf0;">
            <label style="font-size: 0.85rem; font-weight: 700; color: #173044;">🪙 Coins:</label>
            <input id="trade-my-coins" type="number" min="0" max="999999" value="0" style="flex: 1; padding: 6px 10px; background: #ffffff; border: 1px solid #c7d6df; color: #173044; border-radius: 6px; font-weight: 700;" />
          </div>
        </div>

        <!-- Their Offer -->
        <div id="panel-their-offer" style="background: #ffffff; border: 1px solid #dce6ec; border-radius: 14px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div id="label-their-offer" style="font-weight: 800; font-size: 0.95rem; color: #173044;">Their Offer</div>
            <span id="badge-their-ready" style="font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 8px; background: #e2e8f0; color: #597080;">Reviewing offer</span>
          </div>
          <div id="their-trade-slots" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
            ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `
              <div class="trade-slot" data-slot="${i}" style="height: 72px; background: #edf3f7; border: 1px dashed #d6e1e9; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.72rem; color: #768897; text-align: center; padding: 4px; overflow: hidden;">
                <span>Empty</span>
              </div>
            `).join('')}
          </div>
          <div style="display: flex; align-items: center; gap: 8px; background: #f8fbff; padding: 8px 10px; border-radius: 8px; border: 1px solid #e2eaf0;">
            <span style="font-size: 0.85rem; font-weight: 700; color: #173044;">🪙 Coins Offered:</span>
            <span id="their-trade-coins" style="font-weight: 800; color: #e5b945; font-size: 0.95rem;">0</span>
          </div>
        </div>
      </div>

      <!-- Inventory Drawer (Tradeable items) -->
      <div style="background: #e9f0f5; border: 1px solid #dce6ec; border-radius: 14px; padding: 14px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: #173044; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span>📦 Your Inventory (Click an item to offer):</span>
          <span style="font-size: 0.78rem; color: #597080;">${this.myInventory.length} tradeable items</span>
        </div>
        <div id="trade-inventory-shelf" style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px;">
          ${this.myInventory.length === 0 ? '<div style="color:#768897; font-size:0.85rem; padding:8px;">No tradeable items in inventory.</div>' : ''}
          ${this.myInventory.map((item) => `
            <div class="inventory-trade-chip" data-item-id="${item.itemId}" data-name="${item.name}" style="background: #ffffff; border: 1px solid #c7d6df; border-radius: 10px; padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 0.85rem; font-weight: 600; color: #173044; transition: all 0.15s ease; box-shadow: 0 2px 5px rgba(0,0,0,0.04);">
              <span>🎁</span>
              <span>${item.name}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Controls -->
      <div style="display: flex; gap: 12px; justify-content: flex-end; align-items: center; border-top: 1px solid #dce6ec; padding-top: 14px;">
        <button id="btn-trade-ready" style="background: var(--mp-gold, #ffd65b); border: 1px solid #e5b945; color: #242017; padding: 10px 24px; border-radius: 10px; font-weight: 800; cursor: pointer; transition: all 0.15s;">Ready</button>
        <button id="btn-trade-confirm" style="background: #247c49; color: #ffffff; border: none; padding: 10px 24px; border-radius: 10px; font-weight: 800; cursor: pointer; display: none;">Confirm Swap</button>
        <button id="btn-trade-cancel" style="background: transparent; border: 1px solid #dce6ec; color: #597080; padding: 10px 20px; border-radius: 10px; font-weight: 700; cursor: pointer;">Cancel</button>
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

    // Find lowest available slot 0..7
    const occupied = new Set(myItems.map((i) => i.slotIndex));
    let targetSlot = -1;
    for (let s = 0; s < 8; s++) {
      if (!occupied.has(s)) {
        targetSlot = s;
        break;
      }
    }

    if (targetSlot === -1) {
      showToast({ icon: '⚠️', title: 'Offer Full', subtitle: 'All 8 trade slots are occupied.' });
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
        slotEl.innerHTML = `<span style="font-size:1.3rem; margin-bottom:2px;">🎁</span><strong style="color:#173044; font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85%;">${item.name}</strong><span style="font-size:0.62rem; color:#e05252; font-weight:700;">(remove)</span>`;
        (slotEl as HTMLElement).style.borderColor = '#4ecdc4';
        (slotEl as HTMLElement).style.background = '#ffffff';
        (slotEl as HTMLElement).style.borderStyle = 'solid';
        (slotEl as HTMLElement).style.boxShadow = '0 2px 8px rgba(78, 205, 196, 0.25)';
      } else {
        slotEl.innerHTML = `<span>Empty</span>`;
        (slotEl as HTMLElement).style.borderColor = '#d6e1e9';
        (slotEl as HTMLElement).style.background = '#edf3f7';
        (slotEl as HTMLElement).style.borderStyle = 'dashed';
        (slotEl as HTMLElement).style.boxShadow = 'none';
      }
    });

    // Update Their Slots
    const theirSlotMap = new Map<number, TradeOfferItem>();
    for (const item of theirItems) theirSlotMap.set(item.slotIndex, item);

    this.overlay.querySelectorAll('#their-trade-slots .trade-slot').forEach((slotEl) => {
      const idx = parseInt(slotEl.getAttribute('data-slot') || '0', 10);
      const item = theirSlotMap.get(idx);
      if (item) {
        slotEl.innerHTML = `<span style="font-size:1.3rem; margin-bottom:2px;">🎁</span><strong style="color:#173044; font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85%;">${item.name}</strong>`;
        (slotEl as HTMLElement).style.borderColor = '#38bdf8';
        (slotEl as HTMLElement).style.background = '#ffffff';
        (slotEl as HTMLElement).style.borderStyle = 'solid';
        (slotEl as HTMLElement).style.boxShadow = '0 2px 8px rgba(56, 189, 248, 0.25)';
      } else {
        slotEl.innerHTML = `<span>Empty</span>`;
        (slotEl as HTMLElement).style.borderColor = '#d6e1e9';
        (slotEl as HTMLElement).style.background = '#edf3f7';
        (slotEl as HTMLElement).style.borderStyle = 'dashed';
        (slotEl as HTMLElement).style.boxShadow = 'none';
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
      myBadge.textContent = myReady ? '✓ Confirmed' : 'Reviewing offer';
      myBadge.style.background = myReady ? '#247c49' : '#e2e8f0';
      myBadge.style.color = myReady ? '#ffffff' : '#597080';
    }

    const theirBadge = this.overlay.querySelector('#badge-their-ready') as HTMLElement;
    if (theirBadge) {
      theirBadge.textContent = theirReady ? '✓ Confirmed' : 'Reviewing offer';
      theirBadge.style.background = theirReady ? '#247c49' : '#e2e8f0';
      theirBadge.style.color = theirReady ? '#ffffff' : '#597080';
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
