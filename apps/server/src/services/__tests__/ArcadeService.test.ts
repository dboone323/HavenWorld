import {
  ArcadeService,
  ARCADE_GAME_TYPE,
  ARCADE_WIN_COINS,
  ARCADE_WEEKLY_COIN_CAP,
  ARCADE_HOURLY_COIN_LIMIT,
  ARCADE_MATCH_RETENTION_MS,
} from '../ArcadeService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

function currentWeekStart(): Date {
  const startOfWeek = new Date();
  startOfWeek.setUTCHours(0, 0, 0, 0);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
  return startOfWeek;
}

/**
 * A full 6×7 board with 21 discs each and no four-in-a-row in any direction:
 * a 2×2 checkerboard tile.
 */
function drawnBoard(): number[][] {
  const rowA = [1, 1, 2, 2, 1, 1, 2];
  const rowB = [2, 2, 1, 1, 2, 2, 1];
  return Array.from({ length: 6 }, (_, r) => [...(r % 2 === 0 ? rowA : rowB)]);
}

/** Four p1 drops in one column: the fastest legal Connect-4 finish. */
function finishedMatch(kind: 'win' | 'draw', p1: string, p2: string, cabinetId = 'cab-1') {
  const match = ArcadeService.startMatch(p1, p2, cabinetId);
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

describe('ArcadeService (Real Database Validation)', () => {
  const createdUserIds: string[] = [];

  async function makeUser(havenCoins = 500) {
    const user = await createTestUser({ havenCoins });
    createdUserIds.push(user.id);
    return user;
  }

  beforeEach(async () => {
    clearArcadeState();
    await prisma.arcadeSettlementOutbox.deleteMany({});
  });

  afterEach(async () => {
    clearArcadeState();
    await prisma.arcadeSettlementOutbox.deleteMany({});
    if (createdUserIds.length > 0) {
      await prisma.minigameSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.weeklyEarningsCap.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
  });

  afterAll(async () => {
    await prisma.arcadeSettlementOutbox.deleteMany({});
    if (createdUserIds.length > 0) {
      await prisma.minigameSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.weeklyEarningsCap.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.room.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  describe('ArcadeService.settleMatch', () => {
    it('reports a real win before settling', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);
      expect(match.status).toBe('FINISHED');
      expect(match.winnerId).toBe(winner.id);
      expect(match.isDraw).toBe(false);
    });

    it('pays the winner the full skill reward and logs the session in the database', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);

      const result = await ArcadeService.settleMatch(match.id);

      expect(result).toMatchObject({
        matchId: match.id,
        winnerId: winner.id,
        isDraw: false,
        coinsAwarded: ARCADE_WIN_COINS,
        weeklyRemaining: ARCADE_WEEKLY_COIN_CAP - ARCADE_WIN_COINS,
      });

      const [dbWinner, sessions, cap] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: winner.id } }),
        prisma.minigameSession.findMany({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
        prisma.weeklyEarningsCap.findFirst({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
      ]);

      expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].coinsEarned).toBe(ARCADE_WIN_COINS);
      expect(cap?.earned).toBe(ARCADE_WIN_COINS);
    });

    it('settles a match exactly once — repeat calls return the cached payout', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);

      const first = await ArcadeService.settleMatch(match.id);
      const second = await ArcadeService.settleMatch(match.id);
      const third = await ArcadeService.settleMatch(match.id);

      expect(second).toEqual(first);
      expect(third).toEqual(first);

      const dbWinner = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
      expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    });

    it('clamps the payout to what is left in the weekly budget', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      await prisma.weeklyEarningsCap.create({
        data: {
          userId: winner.id,
          gameType: ARCADE_GAME_TYPE,
          earned: ARCADE_WEEKLY_COIN_CAP - 15,
          weekOf: currentWeekStart(),
        },
      });

      const match = finishedMatch('win', winner.id, loser.id);
      const result = await ArcadeService.settleMatch(match.id);

      expect(result.coinsAwarded).toBe(15);
      expect(result.weeklyRemaining).toBe(0);

      const dbWinner = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
      expect(dbWinner.havenCoins).toBe(515);
    });

    it('pays nothing once the weekly cap is spent, but still logs the match', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      await prisma.weeklyEarningsCap.create({
        data: {
          userId: winner.id,
          gameType: ARCADE_GAME_TYPE,
          earned: ARCADE_WEEKLY_COIN_CAP,
          weekOf: currentWeekStart(),
        },
      });

      const match = finishedMatch('win', winner.id, loser.id);
      const result = await ArcadeService.settleMatch(match.id);

      expect(result.coinsAwarded).toBe(0);
      expect(result.weeklyRemaining).toBe(0);

      const [dbWinner, sessions] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: winner.id } }),
        prisma.minigameSession.findMany({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
      ]);
      expect(dbWinner.havenCoins).toBe(500);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].coinsEarned).toBe(0);
    });

    it('shares the rolling hourly minigame budget with other games (§6.2)', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      await prisma.minigameSession.create({
        data: {
          userId: winner.id,
          gameType: 'PIZZA_CHEF',
          coinsEarned: ARCADE_HOURLY_COIN_LIMIT - 25,
          score: 500,
          duration: 60,
        },
      });

      const match = finishedMatch('win', winner.id, loser.id);
      const result = await ArcadeService.settleMatch(match.id);

      expect(result.coinsAwarded).toBe(25);
      const dbWinner = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
      expect(dbWinner.havenCoins).toBe(525);
    });

    it('pays nobody on a draw and caches that answer too', async () => {
      const p1 = await makeUser(500);
      const p2 = await makeUser(500);
      const match = finishedMatch('draw', p1.id, p2.id);
      expect(match.isDraw).toBe(true);

      const result = await ArcadeService.settleMatch(match.id);
      const again = await ArcadeService.settleMatch(match.id);

      expect(result).toMatchObject({
        winnerId: null,
        isDraw: true,
        coinsAwarded: 0,
        weeklyRemaining: ARCADE_WEEKLY_COIN_CAP,
      });
      expect(again).toEqual(result);

      const outbox = await prisma.arcadeSettlementOutbox.findUnique({ where: { matchId: match.id } });
      expect(outbox?.settledAt).not.toBeNull();
      expect(outbox?.coinsAwarded).toBe(0);
    });

    it('refuses to settle a match that is still in progress', async () => {
      const p1 = await makeUser(500);
      const p2 = await makeUser(500);
      const match = ArcadeService.startMatch(p1.id, p2.id, 'cab-1');

      await expect(ArcadeService.settleMatch(match.id)).rejects.toThrow('Match is still in progress');
    });
  });

  describe('ArcadeService cabinet occupancy', () => {
    it('refuses a second live match on the same cabinet', () => {
      ArcadeService.startMatch('u-a', 'u-b', 'cab-1');

      expect(ArcadeService.busyCabinet('cab-1')).toBe(true);
      expect(() => ArcadeService.startMatch('u-c', 'u-d', 'cab-1')).toThrow('already running a match');
    });

    it('frees the cabinet again once the match is decided', () => {
      const match = finishedMatch('win', 'u-a', 'u-b', 'cab-1');

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

  describe('ArcadeService settlement retries & retention (§6.3)', () => {
    it('pays a finished match nobody ever settled and does not double-pay on subsequent sweeps', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);

      ArcadeService.queueUnsettledFinishedMatches();
      expect(ArcadeService.pendingSettlementCount()).toBe(1);
      const settled = await ArcadeService.settlePendingMatches();
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({
        matchId: match.id,
        winnerId: winner.id,
        coinsAwarded: ARCADE_WIN_COINS,
      });
      expect(ArcadeService.pendingSettlementCount()).toBe(0);

      // Sweeping again must not pay the same win twice.
      ArcadeService.queueUnsettledFinishedMatches();
      await expect(ArcadeService.settlePendingMatches()).resolves.toHaveLength(0);

      const dbWinner = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
      expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    });

    it('leaves a failed payout queued and never prunes it while still owed', async () => {
      // A match won by a not-yet-persisted user ID fails foreign key constraint on settle
      const missingWinnerId = `unpersisted_${Date.now()}`;
      const match = finishedMatch('win', missingWinnerId, 'u-lose');

      let settleError: unknown = null;
      try {
        await ArcadeService.settleMatch(match.id);
      } catch (err) {
        settleError = err;
      }
      expect(settleError).not.toBeNull();
      ArcadeService.queueSettlementRetry(match.id);
      expect(ArcadeService.pendingSettlementCount()).toBe(1);

      await expect(ArcadeService.settlePendingMatches()).resolves.toHaveLength(0);
      expect(ArcadeService.pendingSettlementCount()).toBe(1);

      // Even if old, an unpaid match is never pruned
      match.createdAt -= ARCADE_MATCH_RETENTION_MS + 1;
      expect(ArcadeService.pruneFinishedMatches()).toBe(0);
      expect(ArcadeService.getMatch(match.id)).not.toBeNull();
    });

    it('forgets a paid match only once it goes stale', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);
      await ArcadeService.settleMatch(match.id);

      expect(ArcadeService.pruneFinishedMatches()).toBe(0);
      expect(ArcadeService.getMatch(match.id)).not.toBeNull();

      match.createdAt -= ARCADE_MATCH_RETENTION_MS + 1;
      expect(ArcadeService.pruneFinishedMatches()).toBe(1);
      expect(ArcadeService.getMatch(match.id)).toBeNull();

      await expect(ArcadeService.settleMatch(match.id)).rejects.toThrow('Arcade match not found');
    });

    it('never queues or prunes a match that is still in progress', () => {
      const live = ArcadeService.startMatch('u-live1', 'u-live2', 'cab-live');
      live.createdAt -= ARCADE_MATCH_RETENTION_MS * 2;

      ArcadeService.queueSettlementRetry(live.id);
      ArcadeService.queueUnsettledFinishedMatches();
      expect(ArcadeService.pendingSettlementCount()).toBe(0);
      expect(ArcadeService.pruneFinishedMatches()).toBe(0);
      expect(ArcadeService.busyCabinet('cab-live')).toBe(true);
    });
  });

  describe('ArcadeService durable payout outbox & startup recovery (§6.3)', () => {
    it('writes the owed-payout row the moment the board is decided and replays on startup recovery', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);

      await expect(ArcadeService.recordOwedPayout(match)).resolves.toBe(true);

      const rowBefore = await prisma.arcadeSettlementOutbox.findUnique({
        where: { matchId: match.id },
      });
      expect(rowBefore).toMatchObject({
        matchId: match.id,
        gameType: ARCADE_GAME_TYPE,
        cabinetId: 'cab-1',
        player1Id: winner.id,
        player2Id: loser.id,
        winnerId: winner.id,
        isDraw: false,
        settledAt: null,
      });

      // Simulate server restart: clear in-memory state and recover from DB outbox
      clearArcadeState();
      const settled = await ArcadeService.recoverPendingSettlements();
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({
        matchId: match.id,
        winnerId: winner.id,
        isDraw: false,
        coinsAwarded: ARCADE_WIN_COINS,
      });

      const dbWinner = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
      expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);

      // Re-running startup recovery after settlement is a no-op
      clearArcadeState();
      await expect(ArcadeService.recoverPendingSettlements()).resolves.toEqual([]);
    });

    it('refuses to record a debt for a match that is still live', async () => {
      const live = ArcadeService.startMatch('u-a', 'u-b', 'cab-1');
      await expect(ArcadeService.recordOwedPayout(live)).resolves.toBe(false);
    });

    it('replays stored numbers instead of paying twice when the outbox row was already settled', async () => {
      const winner = await makeUser(500);
      const loser = await makeUser(500);
      const match = finishedMatch('win', winner.id, loser.id);

      // Pre-settle the outbox row in DB as if another process already claimed it
      await prisma.arcadeSettlementOutbox.create({
        data: {
          matchId: match.id,
          gameType: ARCADE_GAME_TYPE,
          cabinetId: 'cab-1',
          player1Id: winner.id,
          player2Id: loser.id,
          winnerId: winner.id,
          isDraw: false,
          startedAt: new Date(match.createdAt),
          finishedAt: new Date(),
          settledAt: new Date(),
          coinsAwarded: ARCADE_WIN_COINS,
          weeklyRemaining: ARCADE_WEEKLY_COIN_CAP - ARCADE_WIN_COINS,
        },
      });

      const result = await ArcadeService.settleMatch(match.id);
      expect(result).toMatchObject({
        matchId: match.id,
        coinsAwarded: ARCADE_WIN_COINS,
      });

      // Winner's balance was NOT incremented a second time
      const dbWinner = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
      expect(dbWinner.havenCoins).toBe(500);
    });

    it('closes out an owed draw on startup recovery without crediting anyone', async () => {
      const p1 = await makeUser(500);
      const p2 = await makeUser(500);
      const match = finishedMatch('draw', p1.id, p2.id);

      await expect(ArcadeService.recordOwedPayout(match)).resolves.toBe(true);
      clearArcadeState();

      const settled = await ArcadeService.recoverPendingSettlements();
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({
        matchId: match.id,
        isDraw: true,
        coinsAwarded: 0,
      });
    });
  });
});
