import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TradeModal } from '../TradeModal';
import { socketService } from '../../services/socket';
import { SOCKET_EVENTS, type TradeStateData } from '@havenworld/shared';
import { authService } from '../../services/auth';

describe('TradeModal (Real Functional UI Validation)', () => {
  let modal: TradeModal;

  beforeEach(() => {
    document.body.innerHTML = '';
    // User credentials for authService
    (authService as any)._user = {
      id: 'test-user-a',
      username: 'Alice',
      avatar: { outfitBody: 'equipped-shirt-id' },
    };
    (authService as any)._accessToken = 'mock-token';
    modal = new TradeModal();
  });

  afterEach(() => {
    modal?.close();
    document.body.innerHTML = '';
  });

  it('renders incoming trade prompt and emits TRADE_ACCEPT when accepted', () => {
    const emitSpy = vi.spyOn(socketService, 'emit');

    // Trigger incoming trade request
    (socketService as any)._emitter?.emit
      ? (socketService as any)._emitter.emit(SOCKET_EVENTS.TRADE_REQUESTED, {
          tradeId: 't1',
          initiatorId: 'other-user',
          initiatorName: 'Bob',
        })
      : null;

    // Direct invocation via private method or via DOM verification
    (modal as any).showIncomingPrompt('Bob');

    const prompt = document.getElementById('trade-incoming-prompt');
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain('Bob wants to trade with you.');

    const acceptBtn = document.getElementById('btn-trade-accept-req');
    expect(acceptBtn).not.toBeNull();
    acceptBtn?.click();

    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.TRADE_ACCEPT, {});
    expect(document.getElementById('trade-incoming-prompt')).toBeNull();
  });

  it('renders 8 slots for both players and updates ready/confirm buttons', async () => {
    await modal.open();

    const overlay = document.getElementById('trade-modal-overlay');
    expect(overlay).not.toBeNull();

    // Verify 8 slots for my offer
    const mySlots = overlay?.querySelectorAll('#my-trade-slots .trade-slot');
    expect(mySlots?.length).toBe(8);

    // Verify 8 slots for their offer
    const theirSlots = overlay?.querySelectorAll('#their-trade-slots .trade-slot');
    expect(theirSlots?.length).toBe(8);

    // Feed trade state update
    const state: TradeStateData = {
      tradeId: 't1',
      initiatorId: 'test-user-a',
      receiverId: 'test-user-b',
      initiatorItems: [
        { slotIndex: 0, inventoryItemId: 'inv-item-1', name: 'Magic Hat' },
      ],
      receiverItems: [],
      initiatorCoins: 50,
      receiverCoins: 0,
      initiatorReady: true,
      receiverReady: false,
      initiatorConfirmed: false,
      receiverConfirmed: false,
      state: 'OFFER_PHASE',
    };

    (modal as any).currentTrade = state;
    (modal as any).updateUI();

    const slot0 = overlay?.querySelector('#my-trade-slots [data-slot="0"]');
    expect(slot0?.textContent).toContain('Magic Hat');

    const myBadge = document.getElementById('badge-my-ready');
    expect(myBadge?.textContent).toBe('✓ Confirmed');
  });

  it('dismisses modal cleanly when cancel button is clicked', async () => {
    const emitSpy = vi.spyOn(socketService, 'emit');
    await modal.open();

    const cancelBtn = document.getElementById('btn-trade-cancel');
    expect(cancelBtn).not.toBeNull();
    cancelBtn?.click();

    expect(emitSpy).toHaveBeenCalledWith(SOCKET_EVENTS.TRADE_CANCEL, {});
    expect(document.getElementById('trade-modal-overlay')).toBeNull();
  });
});
