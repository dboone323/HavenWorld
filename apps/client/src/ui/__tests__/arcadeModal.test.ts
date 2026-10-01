import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ToastNotification caches its container element and the shared setup file clears
// document.body between tests, so DOM assertions would only work for whichever
// test happens to create that container first. Assert the calls instead.
vi.mock('../ToastNotification', () => ({ showToast: vi.fn() }));

import { ArcadeModal } from '../ArcadeModal';
import { showToast } from '../ToastNotification';
import { socketService } from '../../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';

type Handler = (data: unknown) => void;

/**
 * ArcadeModal listens through socketService.on, so capturing those handlers lets
 * a test replay exactly what the server sends — including a payout that arrives
 * late, the way the server's settlement-retry sweep delivers it (§6.3).
 */
function captureSocket() {
  const handlers = new Map<string, Set<Handler>>();
  (vi.spyOn(socketService, 'on') as any).mockImplementation((event: string, handler: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => { handlers.get(event)?.delete(handler); };
  });
  const emit = vi.spyOn(socketService, 'emit').mockImplementation(() => undefined);
  return {
    emit,
    fire(event: string, data: unknown) {
      handlers.get(event)?.forEach((handler) => handler(data));
    },
  };
}

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

/** Every toast shown so far, flattened to one string per toast. */
function toasts(): string[] {
  return vi.mocked(showToast).mock.calls.map((call) => {
    const opts = call[0] as { icon?: string; title: string; subtitle?: string };
    return [opts.icon, opts.title, opts.subtitle].filter(Boolean).join(' ');
  });
}

/** Text inside the arcade overlay only. */
const modalText = () => document.getElementById('arcade-modal-overlay')?.textContent ?? '';
const slots = () => document.querySelectorAll('#arcade-modal-overlay [data-col]').length;

const SELF = { selfId: 'me', selfName: 'Me', players: [{ userId: 'roommate', username: 'Roommate' }] };

describe('ArcadeModal Connect-4 payout messaging (§6.3)', () => {
  let socket: ReturnType<typeof captureSocket>;

  beforeEach(() => {
    ArcadeModal.dismiss();
    vi.mocked(showToast).mockClear();
    socket = captureSocket();
  });

  afterEach(() => {
    ArcadeModal.dismiss();
    vi.restoreAllMocks();
  });

  it('sends column drops for the server to judge', () => {
    ArcadeModal.show(SELF);
    socket.fire(SOCKET_EVENTS.ARCADE_STATE, matchState());

    const cell = document.querySelector<HTMLElement>('#arcade-modal-overlay [data-col="3"]');
    expect(cell).not.toBeNull();
    cell?.click();

    expect(socket.emit).toHaveBeenCalledWith(SOCKET_EVENTS.ARCADE_MOVE, {
      matchId: 'c4_ui_test',
      col: 3,
    });
  });

  it('announces the coins the server paid, even when the result arrives after the win', () => {
    ArcadeModal.show(SELF);
    socket.fire(SOCKET_EVENTS.ARCADE_STATE, matchState());

    // The board decides first; the settlement can land afterwards.
    socket.fire(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', winnerId: 'me', board: wonBoard() })
    );
    expect(toasts().some((t) => t.includes('You win!'))).toBe(true);

    socket.fire(SOCKET_EVENTS.ARCADE_RESULT, {
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
    socket.fire(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', winnerId: 'me', board: wonBoard() })
    );

    socket.fire(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 0,
      weeklyRemaining: 0,
    });

    expect(toasts().some((t) => t.includes('Arcade budget used up'))).toBe(true);
    // A clamped win must never be dressed up as a payout.
    expect(toasts().some((t) => t.includes('+0'))).toBe(false);
    expect(modalText()).not.toContain('HavenCoins earned');
  });

  it('pays nobody on a draw and does not mention the budget', () => {
    ArcadeModal.show(SELF);
    socket.fire(SOCKET_EVENTS.ARCADE_STATE, matchState({ status: 'FINISHED', isDraw: true }));
    socket.fire(SOCKET_EVENTS.ARCADE_RESULT, {
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
    socket.fire(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({
        status: 'FINISHED',
        winnerId: 'roommate',
        board: wonBoard().map((row) => row.map((cell) => (cell === 1 ? 2 : cell))),
      })
    );
    socket.fire(SOCKET_EVENTS.ARCADE_RESULT, {
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
    socket.fire(
      SOCKET_EVENTS.ARCADE_STATE,
      matchState({ status: 'FINISHED', winnerId: 'me', board: wonBoard() })
    );
    socket.fire(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 40,
      weeklyRemaining: 760,
    });
    expect(modalText()).toContain('+40 HavenCoins earned');

    ArcadeModal.dismiss();
    ArcadeModal.show(SELF);

    // No stale board, no stale payout — just the opponent picker.
    expect(modalText()).not.toContain('HavenCoins earned');
    expect(slots()).toBe(0);
    expect(modalText()).toContain('Roommate');

    // A replayed broadcast from the previous match must not resurrect its payout.
    socket.fire(SOCKET_EVENTS.ARCADE_RESULT, {
      matchId: 'c4_ui_test',
      winnerId: 'me',
      isDraw: false,
      coinsAwarded: 40,
      weeklyRemaining: 760,
    });
    expect(modalText()).not.toContain('HavenCoins earned');
  });
});
