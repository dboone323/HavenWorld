import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArcadeModal } from '../ArcadeModal';
import { clearToasts } from '../ToastNotification';
import { socketService } from '../../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import type { SocketEventType } from '@havenworld/shared';

const emptyBoard = () => Array.from({ length: 6 }, () => Array(7).fill(0));

/** A Connect-4 broadcast in the shape ArcadeService sends on ARCADE_STATE. */
function matchState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c4_ui_test',
    cabinetId: 'cab-1',
    player1Id: 'me',
    player2Id: 'roommate',
    currentTurn: 'me',
    board: emptyBoard(),
    status: 'IN_PROGRESS',
    winnerId: null,
    isDraw: false,
    ...overrides,
  };
}

/** Board with four red discs stacked in column 0 — a finished p1 win. */
function wonBoard(): number[][] {
  const board = emptyBoard();
  for (const row of [5, 4, 3, 2]) board[row][0] = 1;
  return board;
}

/** Every real toast rendered in the DOM container, flattened to one string per toast. */
function toasts(): string[] {
  const nodes = document.querySelectorAll('#haven-toast-container .haven-toast');
  return Array.from(nodes).map((n) => n.textContent ?? '');
}

/** Text inside the arcade overlay only. */
const modalText = () => document.getElementById('arcade-modal-overlay')?.textContent ?? '';
const slots = () => document.querySelectorAll('#arcade-modal-overlay [data-col]').length;

const SELF = { selfId: 'me', selfName: 'Me', players: [{ userId: 'roommate', username: 'Roommate' }] };

describe('ArcadeModal Connect-4 payout messaging (§6.3 — Real Functional Validation)', () => {
  let emitted: Array<{ event: SocketEventType; payload: unknown }> = [];
  let offEmit: (() => void) | null = null;

  beforeEach(() => {
    socketService.disconnect();
    ArcadeModal.dismiss();
    clearToasts();
    emitted = [];
    offEmit = socketService.onEmit((event, args) => {
      emitted.push({ event, payload: args[0] });
    });
  });

  afterEach(() => {
    ArcadeModal.dismiss();
    clearToasts();
    offEmit?.();
    offEmit = null;
  });

  it('sends column drops for the server to judge', () => {
    ArcadeModal.show(SELF);
    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_STATE, matchState());

    const cell = document.querySelector<HTMLElement>('#arcade-modal-overlay [data-col="3"]');
    expect(cell).not.toBeNull();
    cell?.click();

    expect(emitted).toContainEqual({
      event: SOCKET_EVENTS.ARCADE_MOVE,
      payload: { matchId: 'c4_ui_test', col: 3 },
    });
  });

  it('announces the coins the server paid, even when the result arrives after the win', () => {
    ArcadeModal.show(SELF);
    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_STATE, matchState());

    socketService.dispatchIncoming(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', winnerId: 'me', board: wonBoard() })
    );
    expect(toasts().some((t) => t.includes('You win!'))).toBe(true);

    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 40,
      weeklyRemaining: 760,
    });

    expect(toasts().some((t) => t.includes('+40 HavenCoins'))).toBe(true);
    expect(toasts().some((t) => t.includes("760 left in this week's arcade budget"))).toBe(true);
    expect(modalText()).toContain('+40 HavenCoins earned');
    expect(modalText()).toContain("760 left in this week's arcade budget");
  });

  it('says the weekly budget is used up instead of paying out +0 coins', () => {
    ArcadeModal.show(SELF);
    socketService.dispatchIncoming(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', winnerId: 'me', board: wonBoard() })
    );

    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 0,
      weeklyRemaining: 0,
    });

    expect(toasts().some((t) => t.includes('Arcade budget used up'))).toBe(true);
    expect(toasts().some((t) => t.includes('+0'))).toBe(false);
    expect(modalText()).not.toContain('HavenCoins earned');
  });

  it('pays nobody on a draw and does not mention the budget', () => {
    ArcadeModal.show(SELF);
    socketService.dispatchIncoming(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', isDraw: true })
    );
    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: null,
      isDraw: true,
      coinsAwarded: 0,
      weeklyRemaining: 0,
    });

    expect(toasts().some((t) => t.includes('Draw'))).toBe(true);
    expect(toasts().some((t) => t.includes('Arcade budget used up'))).toBe(false);
    expect(toasts().some((t) => t.includes('HavenCoins'))).toBe(false);
    expect(modalText()).toContain('Draw!');
    expect(modalText()).not.toContain('HavenCoins earned');
  });

  it('reports a loss without claiming coins for the winner', () => {
    ArcadeModal.show(SELF);
    socketService.dispatchIncoming(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({
        status: 'FINISHED',
        winnerId: 'roommate',
        board: wonBoard().map((row) => row.map((cell) => (cell === 1 ? 2 : cell))),
      })
    );
    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'roommate',
      isDraw: false,
      coinsAwarded: 40,
      weeklyRemaining: 760,
    });

    expect(toasts().some((t) => t.includes('You lose!'))).toBe(true);
    expect(toasts().some((t) => t.includes('+40 HavenCoins'))).toBe(false);
    expect(modalText()).toContain('Roommate won');
    expect(modalText()).not.toContain('HavenCoins earned');
  });

  it('clears a finished match on dismiss so the next cabinet starts blank', () => {
    ArcadeModal.show(SELF);
    socketService.dispatchIncoming(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', winnerId: 'me', board: wonBoard() })
    );
    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 40,
      weeklyRemaining: 760,
    });
    expect(modalText()).toContain('+40 HavenCoins earned');

    ArcadeModal.dismiss();
    ArcadeModal.show(SELF);

    expect(modalText()).not.toContain('HavenCoins earned');
    expect(slots()).toBe(0);
    expect(modalText()).toContain('Roommate');

    socketService.dispatchIncoming(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 40,
      weeklyRemaining: 760,
    });
    expect(modalText()).not.toContain('HavenCoins earned');
  });
});
