import type { ArcadeSettlementOutbox } from '@prisma/client';
import {
  ArcadeService,
  ARCADE_GAME_TYPE,
  ARCADE_WIN_COINS,
  ARCADE_WEEKLY_COIN_CAP,
  ARCADE_HOURLY_COIN_LIMIT,
  ARCADE_MATCH_RETENTION_MS,
} from '../ArcadeService';

jest.mock('../../prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    minigameSession: { aggregate: jest.fn() },
    arcadeSettlementOutbox: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import { prisma } from '../../prisma';

const mockTransaction = prisma.$transaction as jest.Mock;
const mockHourlyAggregate = prisma.minigameSession.aggregate as jest.Mock;
const mockOutboxUpsert = prisma.arcadeSettlementOutbox.upsert as jest.Mock;
const mockOutboxUpdateMany = prisma.arcadeSettlementOutbox.updateMany as jest.Mock;
const mockOutboxFindMany = prisma.arcadeSettlementOutbox.findMany as jest.Mock;

type Cap = { id: string; earned: number };

/** An outbox row shaped exactly as Prisma returns it. */
function outboxRow(
  overrides: Partial<ArcadeSettlementOutbox> & { matchId: string }
): ArcadeSettlementOutbox {
  const row: ArcadeSettlementOutbox = {
    matchId: 'c4_row',
    gameType: ARCADE_GAME_TYPE,
    cabinetId: 'cab-1',
    player1Id: 'u-win',
    player2Id: 'u-lose',
    winnerId: 'u-win',
    isDraw: false,
    startedAt: new Date('2026-09-30T00:00:00.000Z'),
    finishedAt: new Date('2026-09-30T00:02:00.000Z'),
    coinsAwarded: 0,
    weeklyRemaining: ARCADE_WEEKLY_COIN_CAP,
    settledAt: null,
    attempts: 0,
    lastError: null,
  };
  return { ...row, ...overrides };
}

/**
 * Interactive-transaction stub covering exactly the models ArcadeService
 * touches, so assertions can read the mutations it attempted.
 */
function installTx(cap: Cap | null, opts: { alreadySettled?: boolean } = {}) {
  const calls = {
    capCreated: [] as Array<Record<string, unknown>>,
    capUpdated: [] as Array<{ id: string; earned: number }>,
    coinsIncremented: [] as number[],
    sessions: [] as Array<Record<string, unknown>>,
    outboxClaimed: [] as Array<{ matchId: string; coinsAwarded: number }>,
  };

  const tx = {
    weeklyEarningsCap: {
      findUnique: jest.fn(async () => cap),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.capCreated.push(data);
        return { ...cap, id: 'cap-1', earned: 0, ...data };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { earned: { increment: number } } }) => {
        calls.capUpdated.push({ id: where.id, earned: data.earned.increment });
        return {};
      }),
    },
    user: {
      update: jest.fn(async ({ data }: { data: { havenCoins: { increment: number } } }) => {
        calls.coinsIncremented.push(data.havenCoins.increment);
        return {};
      }),
    },
    minigameSession: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.sessions.push(data);
        return {};
      }),
    },
    arcadeSettlementOutbox: {
      upsert: jest.fn(async () => ({})),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { matchId: string; settledAt: null };
          data: { coinsAwarded: number; weeklyRemaining: number };
        }) => {
          calls.outboxClaimed.push({ matchId: where.matchId, coinsAwarded: data.coinsAwarded });
          // count 0 models "someone already settled this" — the double-pay guard.
          return { count: opts.alreadySettled ? 0 : 1 };
        }
      ),
      findUnique: jest.fn(async ({ where }: { where: { matchId: string } }) =>
        opts.alreadySettled
          ? outboxRow({ matchId: where.matchId, settledAt: new Date(0), coinsAwarded: ARCADE_WIN_COINS })
          : null
      ),
    },
  };

  // Run the callback the way Prisma does, and pass its value straight through.
  mockTransaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return { tx, calls };
}

/**
 * A full 6×7 board with 21 discs each and no four-in-a-row in any direction:
 * a 2×2 checkerboard tile. Built directly because settleMatch only reads the
 * finished state, and hand-checkmating a legal 42-ply game is brittle.
 */
function drawnBoard(): number[][] {
  const rowA = [1, 1, 2, 2, 1, 1, 2];
  const rowB = [2, 2, 1, 1, 2, 2, 1];
  return Array.from({ length: 6 }, (_, r) => [...(r % 2 === 0 ? rowA : rowB)]);
}

/** Four p1 drops in one column: the fastest legal Connect-4 finish. */
function finishedMatch(kind: 'win' | 'draw', p1 = 'u-win', p2 = 'u-lose') {
  const match = ArcadeService.startMatch(p1, p2, 'cab-1');
  if (kind === 'draw') {
    match.board = drawnBoard();
    match.status = 'FINISHED';
    match.isDraw = true;
    match.winnerId = null;
    return match;
  }
  for (const col of [0, 1, 0, 1, 0, 1, 0]) {
    ArcadeService.makeMove(match.id, match.currentTurn, col);
    if (match.status === 'FINISHED') break;
  }
  return match;
}

function clearArcadeState() {
  const internals = ArcadeService as unknown as {
    matches: Map<string, unknown>;
    settlements: Map<string, unknown>;
    pendingSettlements: Set<string>;
  };
  internals.matches.clear();
  internals.settlements.clear();
  internals.pendingSettlements.clear();
}

describe('ArcadeService.settleMatch', () => {
  beforeEach(() => {
    clearArcadeState();
    mockHourlyAggregate.mockResolvedValue({ _sum: { coinsEarned: 0 } });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('reports a real win before settling', () => {
    const match = finishedMatch('win');
    expect(match.status).toBe('FINISHED');
    expect(match.winnerId).toBe('u-win');
    expect(match.isDraw).toBe(false);
  });

  it('pays the winner the full skill reward and logs the session', async () => {
    const match = finishedMatch('win');
    installTx({ id: 'cap-1', earned: 0 });

    const result = await ArcadeService.settleMatch(match.id);

    expect(result).toMatchObject({
      matchId: match.id,
      winnerId: 'u-win',
      isDraw: false,
      coinsAwarded: ARCADE_WIN_COINS,
      weeklyRemaining: ARCADE_WEEKLY_COIN_CAP - ARCADE_WIN_COINS,
    });
  });

  it('increments coins, the weekly cap, and one minigame session', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 });

    await ArcadeService.settleMatch(match.id);

    expect(calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);
    expect(calls.capUpdated).toEqual([{ id: 'cap-1', earned: ARCADE_WIN_COINS }]);
    expect(calls.sessions).toHaveLength(1);
    expect(calls.sessions[0]).toMatchObject({
      userId: 'u-win',
      gameType: ARCADE_GAME_TYPE,
      coinsEarned: ARCADE_WIN_COINS,
    });
  });

  it('creates the weekly cap record on a winner’s first payout', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx(null);

    await ArcadeService.settleMatch(match.id);

    expect(calls.capCreated).toHaveLength(1);
    expect(calls.capCreated[0]).toMatchObject({ userId: 'u-win', gameType: ARCADE_GAME_TYPE });
  });

  it('settles a match exactly once — repeat calls return the cached payout', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 });

    const first = await ArcadeService.settleMatch(match.id);
    const second = await ArcadeService.settleMatch(match.id);
    const third = await ArcadeService.settleMatch(match.id);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);
  });

  it('clamps the payout to what is left in the weekly budget', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: ARCADE_WEEKLY_COIN_CAP - 15 });

    const result = await ArcadeService.settleMatch(match.id);

    expect(result.coinsAwarded).toBe(15);
    expect(result.weeklyRemaining).toBe(0);
    expect(calls.coinsIncremented).toEqual([15]);
  });

  it('pays nothing once the weekly cap is spent, but still logs the match', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: ARCADE_WEEKLY_COIN_CAP });

    const result = await ArcadeService.settleMatch(match.id);

    expect(result.coinsAwarded).toBe(0);
    expect(result.weeklyRemaining).toBe(0);
    expect(calls.coinsIncremented).toEqual([]);
    expect(calls.capUpdated).toEqual([]);
    expect(calls.sessions).toHaveLength(1);
    expect(calls.sessions[0]).toMatchObject({ coinsEarned: 0 });
  });

  it('shares the rolling hourly minigame budget with other games (§6.2)', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 });
    mockHourlyAggregate.mockResolvedValue({
      _sum: { coinsEarned: ARCADE_HOURLY_COIN_LIMIT - 25 },
    });

    const result = await ArcadeService.settleMatch(match.id);

    expect(result.coinsAwarded).toBe(25);
    expect(calls.coinsIncremented).toEqual([25]);
  });

  it('pays nobody on a draw and caches that answer too', async () => {
    const match = finishedMatch('draw');
    expect(match.isDraw).toBe(true);
    const { calls } = installTx({ id: 'cap-1', earned: 0 });

    const result = await ArcadeService.settleMatch(match.id);
    const again = await ArcadeService.settleMatch(match.id);

    expect(result).toMatchObject({
      winnerId: null,
      isDraw: true,
      coinsAwarded: 0,
      weeklyRemaining: ARCADE_WEEKLY_COIN_CAP,
    });
    expect(again).toEqual(result);
    // A draw writes exactly one thing: its outbox row is closed out so no later
    // boot re-examines it. No coins, no cap movement, no session.
    expect(calls.outboxClaimed).toEqual([{ matchId: match.id, coinsAwarded: 0 }]);
    expect(calls.coinsIncremented).toEqual([]);
    expect(calls.capUpdated).toEqual([]);
    expect(calls.sessions).toHaveLength(0);
  });

  it('refuses to settle a match that is still in progress', async () => {
    const match = ArcadeService.startMatch('u-win', 'u-lose', 'cab-1');
    installTx({ id: 'cap-1', earned: 0 });

    await expect(ArcadeService.settleMatch(match.id)).rejects.toThrow('Match is still in progress');
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe('ArcadeService cabinet occupancy', () => {
  beforeEach(clearArcadeState);
  afterEach(clearArcadeState);

  it('refuses a second live match on the same cabinet', () => {
    ArcadeService.startMatch('u-a', 'u-b', 'cab-1');

    expect(ArcadeService.busyCabinet('cab-1')).toBe(true);
    expect(() => ArcadeService.startMatch('u-c', 'u-d', 'cab-1')).toThrow('already running a match');
  });

  it('frees the cabinet again once the match is decided', () => {
    const match = finishedMatch('win', 'u-a', 'u-b');

    expect(match.status).toBe('FINISHED');
    expect(ArcadeService.busyCabinet('cab-1')).toBe(false);
    expect(() => ArcadeService.startMatch('u-c', 'u-d', 'cab-1')).not.toThrow();
  });

  it('keeps separate cabinets independent', () => {
    ArcadeService.startMatch('u-a', 'u-b', 'cab-1');

    expect(ArcadeService.activeMatchesForRoom('cab-1')).toHaveLength(1);
    expect(ArcadeService.activeMatchesForRoom('cab-2')).toHaveLength(0);
    expect(ArcadeService.busyCabinet('cab-2')).toBe(false);
  });
});

describe('ArcadeService settlement retries (§6.3)', () => {
  beforeEach(() => {
    clearArcadeState();
    mockHourlyAggregate.mockResolvedValue({ _sum: { coinsEarned: 0 } });
  });
  afterEach(clearArcadeState);

  it('retries a payout whose first attempt failed at the database', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 });
    mockTransaction.mockImplementationOnce(() => Promise.reject(new Error('database unavailable')));

    await expect(ArcadeService.settleMatch(match.id)).rejects.toThrow('database unavailable');
    ArcadeService.queueSettlementRetry(match.id);
    expect(ArcadeService.pendingSettlementCount()).toBe(1);

    const settled = await ArcadeService.settlePendingMatches();
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ matchId: match.id, winnerId: 'u-win', coinsAwarded: ARCADE_WIN_COINS });
    expect(ArcadeService.pendingSettlementCount()).toBe(0);
    // Exactly one credit — the failed attempt wrote nothing.
    expect(calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);
  });

  it('leaves the payout queued while the database is still down', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 });
    mockTransaction.mockRejectedValue(new Error('database unavailable'));
    ArcadeService.queueSettlementRetry(match.id);

    await expect(ArcadeService.settlePendingMatches()).resolves.toHaveLength(0);
    expect(ArcadeService.pendingSettlementCount()).toBe(1);
    expect(calls.coinsIncremented).toEqual([]);

    // Once the database recovers, the queued win is paid.
    const recovered = installTx({ id: 'cap-1', earned: 0 });
    const settled = await ArcadeService.settlePendingMatches();
    expect(settled).toHaveLength(1);
    expect(ArcadeService.pendingSettlementCount()).toBe(0);
    expect(recovered.calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);
  });

  it('pays a finished match nobody ever settled', async () => {
    // Mirrors a winner whose socket dropped before the settlement ran: the board
    // is decided but no payout was ever attempted.
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 });

    ArcadeService.queueUnsettledFinishedMatches();
    expect(ArcadeService.pendingSettlementCount()).toBe(1);
    await expect(ArcadeService.settlePendingMatches()).resolves.toHaveLength(1);
    expect(calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);

    // Sweeping again must not pay the same win twice.
    ArcadeService.queueUnsettledFinishedMatches();
    await expect(ArcadeService.settlePendingMatches()).resolves.toHaveLength(0);
    expect(calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);
    expect(match.status).toBe('FINISHED');
  });

  it('never queues a match that is still in progress', () => {
    const live = ArcadeService.startMatch('u-live1', 'u-live2', 'cab-live');

    ArcadeService.queueSettlementRetry(live.id);
    ArcadeService.queueUnsettledFinishedMatches();
    expect(ArcadeService.pendingSettlementCount()).toBe(0);
  });
});

describe('ArcadeService match retention (§6.3)', () => {
  beforeEach(() => {
    clearArcadeState();
    mockHourlyAggregate.mockResolvedValue({ _sum: { coinsEarned: 0 } });
  });
  afterEach(() => {
    clearArcadeState();
    mockTransaction.mockReset();
  });

  it('forgets a paid match only once it goes stale', async () => {
    const match = finishedMatch('win');
    installTx({ id: 'cap-1', earned: 0 });
    await ArcadeService.settleMatch(match.id);

    // Still fresh: it must stay resident so a replayed move hits the cache.
    expect(ArcadeService.pruneFinishedMatches()).toBe(0);
    expect(ArcadeService.getMatch(match.id)).not.toBeNull();

    match.createdAt -= ARCADE_MATCH_RETENTION_MS + 1;
    expect(ArcadeService.pruneFinishedMatches()).toBe(1);
    expect(ArcadeService.getMatch(match.id)).toBeNull();

    // A forgotten match cannot come back and pay a second time.
    await expect(ArcadeService.settleMatch(match.id)).rejects.toThrow('Arcade match not found');
  });

  it('never prunes a match that still owes a payout', async () => {
    const owed = finishedMatch('win', 'u-owed1', 'u-owed2');
    installTx({ id: 'cap-1', earned: 0 });
    mockTransaction.mockRejectedValue(new Error('database unavailable'));
    await ArcadeService.settleMatch(owed.id).catch(() => undefined);
    ArcadeService.queueSettlementRetry(owed.id);
    owed.createdAt -= ARCADE_MATCH_RETENTION_MS + 1;

    expect(ArcadeService.pruneFinishedMatches()).toBe(0);
    expect(ArcadeService.getMatch(owed.id)).not.toBeNull();
    expect(ArcadeService.pendingSettlementCount()).toBe(1);
  });

  it('leaves a live match running on its cabinet', () => {
    const live = ArcadeService.startMatch('u-live-a', 'u-live-b', 'cab-retention');
    live.createdAt -= ARCADE_MATCH_RETENTION_MS * 2;

    expect(ArcadeService.pruneFinishedMatches()).toBe(0);
    expect(ArcadeService.busyCabinet('cab-retention')).toBe(true);
  });
});

describe('ArcadeService durable payout outbox (§6.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearArcadeState();
    mockHourlyAggregate.mockResolvedValue({ _sum: { coinsEarned: 0 } });
    mockOutboxFindMany.mockResolvedValue([]);
    mockOutboxUpdateMany.mockResolvedValue({ count: 1 });
    mockOutboxUpsert.mockResolvedValue({});
  });
  afterEach(() => {
    clearArcadeState();
    jest.restoreAllMocks();
  });

  it('writes the owed-payout row the moment the board is decided', async () => {
    const match = finishedMatch('win');

    await expect(ArcadeService.recordOwedPayout(match)).resolves.toBe(true);

    expect(mockOutboxUpsert).toHaveBeenCalledTimes(1);
    expect(mockOutboxUpsert.mock.calls[0][0]).toMatchObject({
      where: { matchId: match.id },
      create: {
        matchId: match.id,
        gameType: ARCADE_GAME_TYPE,
        cabinetId: 'cab-1',
        player1Id: 'u-win',
        player2Id: 'u-lose',
        winnerId: 'u-win',
        isDraw: false,
      },
    });
  });

  it('refuses to record a debt for a match that is still live', async () => {
    const live = ArcadeService.startMatch('u-a', 'u-b', 'cab-1');

    await expect(ArcadeService.recordOwedPayout(live)).resolves.toBe(false);
    expect(mockOutboxUpsert).not.toHaveBeenCalled();
  });

  it('keeps playing when the database is down as the debt is written', async () => {
    const match = finishedMatch('win');
    mockOutboxUpsert.mockRejectedValue(new Error('database unavailable'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(ArcadeService.recordOwedPayout(match)).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it('replays stored numbers instead of paying twice when the row is claimed', async () => {
    const match = finishedMatch('win');
    const { calls } = installTx({ id: 'cap-1', earned: 0 }, { alreadySettled: true });

    const result = await ArcadeService.settleMatch(match.id);

    // Another process won the claim: report its payout, write nothing.
    expect(result).toMatchObject({ matchId: match.id, coinsAwarded: ARCADE_WIN_COINS });
    expect(calls.outboxClaimed).toHaveLength(1);
    expect(calls.coinsIncremented).toEqual([]);
    expect(calls.capCreated).toHaveLength(0);
    expect(calls.sessions).toHaveLength(0);
  });
});


describe('ArcadeService startup recovery (§6.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearArcadeState();
    mockHourlyAggregate.mockResolvedValue({ _sum: { coinsEarned: 0 } });
    mockOutboxFindMany.mockResolvedValue([]);
    mockOutboxUpdateMany.mockResolvedValue({ count: 1 });
    mockOutboxUpsert.mockResolvedValue({});
  });
  afterEach(() => {
    clearArcadeState();
    jest.restoreAllMocks();
  });

  it('pays a previous process’s debt with its match long gone', async () => {
    mockOutboxFindMany.mockResolvedValue([outboxRow({ matchId: 'c4_crashed' })]);
    const { calls } = installTx({ id: 'cap-1', earned: 0 });

    const settled = await ArcadeService.recoverPendingSettlements();

    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      matchId: 'c4_crashed',
      winnerId: 'u-win',
      isDraw: false,
      coinsAwarded: ARCADE_WIN_COINS,
    });
    expect(calls.coinsIncremented).toEqual([ARCADE_WIN_COINS]);
    // Duration comes from the row (00:00 → 00:02), not from a wall clock reset.
    expect(calls.sessions[0]).toMatchObject({
      userId: 'u-win',
      coinsEarned: ARCADE_WIN_COINS,
      duration: 120,
    });
    // The claim is written by the same transaction that paid, so there is no
    // window where a payout is marked done and the coins never landed.
    expect(calls.outboxClaimed).toEqual([{ matchId: 'c4_crashed', coinsAwarded: ARCADE_WIN_COINS }]);
  });

  it('closes out an owed draw without crediting anyone', async () => {
    mockOutboxFindMany.mockResolvedValue([
      outboxRow({ matchId: 'c4_draw', winnerId: null, isDraw: true }),
    ]);
    const { calls } = installTx({ id: 'cap-1', earned: 0 });

    const settled = await ArcadeService.recoverPendingSettlements();

    expect(settled[0]).toMatchObject({ matchId: 'c4_draw', isDraw: true, coinsAwarded: 0 });
    expect(calls.outboxClaimed).toEqual([{ matchId: 'c4_draw', coinsAwarded: 0 }]);
    expect(calls.coinsIncremented).toEqual([]);
  });

  it('never throws during boot, and one bad row cannot block the rest', async () => {
    mockOutboxFindMany.mockResolvedValue([
      outboxRow({ matchId: 'c4_a' }),
      outboxRow({ matchId: 'c4_b' }),
    ]);
    installTx({ id: 'cap-1', earned: 0 });
    mockTransaction.mockRejectedValue(new Error('database unavailable'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(ArcadeService.recoverPendingSettlements()).resolves.toEqual([]);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('boots quietly when nothing is owed, including if the query fails', async () => {
    mockOutboxFindMany.mockResolvedValue([]);
    await expect(ArcadeService.recoverPendingSettlements()).resolves.toEqual([]);
    expect(mockTransaction).not.toHaveBeenCalled();

    mockOutboxFindMany.mockRejectedValue(new Error('database unavailable'));
    await expect(ArcadeService.recoverPendingSettlements()).resolves.toEqual([]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

