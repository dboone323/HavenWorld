import { socketService } from '../services/socket';
import { SOCKET_EVENTS, TradeStateData } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';

export class TradeModal {
  private overlay: HTMLElement | null = null;
  private currentTrade: TradeStateData | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    socketService.on<TradeStateData>(SOCKET_EVENTS.TRADE_STATE_UPDATE, (state) => {
      this.currentTrade = state;
      if (!this.overlay) this.render();
      else this.updateUI();
    });

    socketService.on<{ seconds: number }>(SOCKET_EVENTS.TRADE_COUNTDOWN, (data) => {
      const timerEl = document.getElementById('trade-countdown-timer');
      if (timerEl) {
        timerEl.textContent = `Confirming: ${data.seconds}s remaining`;
        timerEl.style.color = '#eab308';
      }
    });

    socketService.on(SOCKET_EVENTS.TRADE_COMPLETE, (data: { summary: string }) => {
      audioEngine.playTradeComplete();
      alert(`🤝 ${data.summary}`);
      this.close();
    });

    socketService.on(SOCKET_EVENTS.TRADE_CANCELLED, (data: { reason: string }) => {
      alert(`❌ Trade Cancelled: ${data.reason}`);
      this.close();
    });
  }

  open(): void {
    if (this.overlay) return;
    this.render();
  }

  close(): void {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.overlay?.remove();
    this.overlay = null;
    this.currentTrade = null;
  }

  private render(): void {
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'trade-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
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
      border-radius: 12px;
      width: min(640px, 94vw);
      padding: 24px;
      color: #e2e8f0;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; color: #4ecdc4;">🤝 Secure Player Trade</h3>
        <span id="trade-countdown-timer" style="font-size: 0.9rem; font-weight: bold; color: #888;"></span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <!-- My Offer -->
        <div style="background: #16213e; border: 1px solid #333; border-radius: 8px; padding: 12px;">
          <div style="font-weight: bold; margin-bottom: 8px; color: #4ecdc4;">My Offer</div>
          <div id="my-trade-slots" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="trade-slot" data-slot="${i}" style="height: 60px; background: #0f172a; border: 1px dashed #475569; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #64748b;">Empty</div>`).join('')}
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 0.85rem;">🪙 Coins:</label>
            <input id="trade-my-coins" type="number" min="0" max="9999" value="0" style="width: 80px; padding: 4px; background: #0f172a; border: 1px solid #475569; color: #ffd700; border-radius: 4px;" />
          </div>
        </div>

        <!-- Their Offer -->
        <div style="background: #16213e; border: 1px solid #333; border-radius: 8px; padding: 12px;">
          <div style="font-weight: bold; margin-bottom: 8px; color: #38bdf8;">Their Offer</div>
          <div id="their-trade-slots" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="trade-slot" style="height: 60px; background: #0f172a; border: 1px dashed #475569; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #64748b;">Empty</div>`).join('')}
          </div>
          <div style="font-size: 0.85rem; color: #ffd700;">🪙 Coins: <span id="their-trade-coins">0</span></div>
        </div>
      </div>

      <!-- Controls -->
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="btn-trade-ready" style="background: #4ecdc4; color: #000; border: none; padding: 8px 18px; border-radius: 6px; font-weight: bold; cursor: pointer;">Ready</button>
        <button id="btn-trade-confirm" style="background: #22c55e; color: #000; border: none; padding: 8px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; display: none;">Confirm Swap</button>
        <button id="btn-trade-cancel" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Cancel</button>
      </div>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

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
      const val = parseInt((e.target as HTMLInputElement).value) || 0;
      socketService.emit(SOCKET_EVENTS.OFFER_COINS, { amount: val });
    });
  }

  private updateUI(): void {
    if (!this.currentTrade || !this.overlay) return;

    const confirmBtn = this.overlay.querySelector('#btn-trade-confirm') as HTMLElement;
    const readyBtn = this.overlay.querySelector('#btn-trade-ready') as HTMLElement;

    if (this.currentTrade.state === 'LOCKED') {
      if (confirmBtn) confirmBtn.style.display = 'inline-block';
      if (readyBtn) readyBtn.style.display = 'none';
    } else {
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (readyBtn) {
        readyBtn.style.display = 'inline-block';
        readyBtn.style.opacity = '1';
      }
    }
  }
}
