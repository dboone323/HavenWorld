import type { ArcadeSettlementOutbox, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Connect-4 payout tuning (§6.3). Rewards are earned purely from skill —
 * nothing is wagered, nothing is purchased, and no random roll decides an
 * outcome. HavenGems are never awarded here (GDD §6.1 limits gems to
 * purchases, milestone achievements and giveaways).
 */
export const ARCADE_GAME_TYPE = 'ARCADE_CONNECT4';
/** Coins paid to the winner of a completed match. */
export const ARCADE_WIN_COINS = 40;
/** Anti-inflation ceiling on arcade earnings per player per UTC week (§6.2). */
export const ARCADE_WEEKLY_COIN_CAP = 800;
/** Rolling 60-minute minigame earnings limit shared with the Pizza Chef loop (§6.2). */
export const ARCADE_HOURLY_COIN_LIMIT = 500;
/**
 * How long a finished, already-paid match is kept in memory. Long enough for
 * both players to see the result and for any replayed move to hit the
 * idempotency cache; after that the board is dead weight.
 */
export const ARCADE_MATCH_RETENTION_MS = 10 * 60 * 1000;

export interface ArcadeSettlement {
  matchId: string;
  winnerId: string | null;
  isDraw: boolean;
  coinsAwarded: number;
  weeklyRemaining: number;
}

/**
 * A payout that is owed: everything needed to pay a match without the board
 * still being in memory. Mirrors the arcade_settlement_outbox row written when
 * the board was decided, so a payout survives a restart (§6.3).
 */
export interface ArcadeSettlementIntent {
  matchId: string;
  cabinetId: string;
  player1Id: string;
  player2Id: string;
  winnerId: string | null;
  isDraw: boolean;
  /** Unix ms: when the board opened and when it was decided. */
  startedAt: number;
  finishedAt: number;
}

/** Start of the current UTC week, matching the Pizza Chef cap window (§6.2). */
function currentWeekStart(): Date {
  const startOfWeek = new Date();
  startOfWeek.setUTCHours(0, 0, 0, 0);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
  return startOfWeek;
}

export interface ConnectFourMatch {
  id: string;
  cabinetId: string;
  player1Id: string;
  player2Id: string;
  currentTurn: string; // userId
  board: number[][]; // 6 rows x 7 cols (0 = empty, 1 = p1, 2 = p2)
  status: 'IN_PROGRESS' | 'FINISHED';
  winnerId: string | null; // null if in progress or draw
  isDraw: boolean;
  createdAt: number;
}

export class ArcadeService {
  private static matches = new Map<string, ConnectFourMatch>();
  /** Idempotency guard: a match can only ever pay out once (survives reconnect/re-broadcast). */
  private static settlements = new Map<string, ArcadeSettlement>();
  /**
   * Finished matches whose payout has not been written yet. A settlement that
   * fails (DB blip, player disconnected mid-settlement, server stall) lands
   * here instead of vanishing, and the socket layer's sweep retries it.
   */
  private static pendingSettlements = new Set<string>();

  /**
   * Initializes a new Connect-4 match between two adjacent players at a cabinet
   */
  static startMatch(player1Id: string, player2Id: string, cabinetId: string): ConnectFourMatch {
    if (player1Id === player2Id) {
      throw new Error('Cannot start an arcade match against yourself');
    }
    if (this.busyCabinet(cabinetId)) {
      throw new Error('That cabinet is already running a match');
    }

    const matchId = `c4_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    // 6 rows x 7 columns empty grid
    const board: number[][] = Array.from({ length: 6 }, () => Array(7).fill(0));

    const match: ConnectFourMatch = {
      id: matchId,
      cabinetId,
      player1Id,
      player2Id,
      currentTurn: player1Id,
      board,
      status: 'IN_PROGRESS',
      winnerId: null,
      isDraw: false,
      createdAt: Date.now(),
    };

    this.matches.set(matchId, match);
    return match;
  }

  static getMatch(matchId: string): ConnectFourMatch | null {
    return this.matches.get(matchId) || null;
  }

  /**
   * Live matches currently tied to a physical prop. One cabinet is one board:
   * a second challenge on the same prop would silently overwrite the first
   * match's state broadcasts, so the socket layer refuses it.
   */
  static activeMatchesForRoom(cabinetId: string): ConnectFourMatch[] {
    return Array.from(this.matches.values()).filter(
      (match) => match.cabinetId === cabinetId && match.status === 'IN_PROGRESS'
    );
  }

  static busyCabinet(cabinetId: string): boolean {
    return this.activeMatchesForRoom(cabinetId).length > 0;
  }

  /**
   * Drops a disc into the chosen column (0 to 6)
   */
  static makeMove(matchId: string, playerId: string, col: number): ConnectFourMatch {
    const match = this.matches.get(matchId);
    if (!match) throw new Error('Arcade match not found');
    if (match.status === 'FINISHED') throw new Error('Match has already finished');
    if (match.currentTurn !== playerId) throw new Error('Not your turn');
    if (col < 0 || col > 6 || !Number.isInteger(col)) throw new Error('Invalid column index (0-6)');

    const disc = playerId === match.player1Id ? 1 : 2;

    // Find the lowest unoccupied row in this column
    let targetRow = -1;
    for (let r = 5; r >= 0; r--) {
      if (match.board[r][col] === 0) {
        targetRow = r;
        break;
      }
    }

    if (targetRow === -1) {
      throw new Error('Column is already full');
    }

    match.board[targetRow][col] = disc;

    // Check for win condition (4 in a line)
    if (this.checkWin(match.board, targetRow, col, disc)) {
      match.status = 'FINISHED';
      match.winnerId = playerId;
      return match;
    }

    // Check for draw (all columns full)
    const isFull = match.board[0].every((cell) => cell !== 0);
    if (isFull) {
      match.status = 'FINISHED';
      match.isDraw = true;
      return match;
    }

    // Alternate turn
    match.currentTurn = playerId === match.player1Id ? match.player2Id : match.player1Id;
    return match;
  }

  /**
   * Pays the winner of a finished match (§6.3). Skill-only payout: the amount
   * is fixed, the winner is decided by the board, and both the rolling hourly
   * and per-week arcade caps clamp the award instead of throwing — a legitimate
   * win is never punished with an error toast once the hourly limit is hit.
   *
   * Durability (§6.3): the payout is claimed in the outbox row that
   * recordOwedPayout wrote when the board was decided, inside the same
   * transaction that credits the coins. A second settle — a replayed
   * ARCADE_MOVE, the retry sweep, or a process that restarted mid-payout — sees
   * the claim and replays the original numbers instead of paying twice.
   */
  static async settleMatch(matchId: string): Promise<ArcadeSettlement> {
    const cached = this.settlements.get(matchId);
    if (cached) return cached;

    const match = this.matches.get(matchId);
    if (!match) throw new Error('Arcade match not found');
    if (match.status !== 'FINISHED') throw new Error('Match is still in progress');

    return this.payOutboxEntry({
      matchId,
      cabinetId: match.cabinetId,
      player1Id: match.player1Id,
      player2Id: match.player2Id,
      winnerId: match.winnerId,
      isDraw: match.isDraw,
      startedAt: match.createdAt,
      finishedAt: Date.now(),
    });
  }

  /**
   * Pays (or closes out) a settlement intent. Private so every caller — live
   * move handler, retry sweep, boot recovery — goes through the same
   * claim-first path.
   */
  private static async payOutboxEntry(intent: ArcadeSettlementIntent): Promise<ArcadeSettlement> {
    const { matchId, winnerId } = intent;
    const cached = this.settlements.get(matchId);
    if (cached) return cached;

    // A draw is a payout of nothing: close the outbox row so recovery stops
    // revisiting it, and hand back the result every later replay must return.
    if (!winnerId || intent.isDraw) {
      const drawResult: ArcadeSettlement = {
        matchId,
        winnerId: winnerId ?? null,
        isDraw: true,
        coinsAwarded: 0,
        weeklyRemaining: ARCADE_WEEKLY_COIN_CAP,
      };
      const drawSettled = await prisma.$transaction<ArcadeSettlement>(async (tx) => {
        return (await this.claimPayout(tx, intent, drawResult)) ?? drawResult;
      });
      this.settlements.set(matchId, drawSettled);
      this.pendingSettlements.delete(matchId);
      return drawSettled;
    }

    const weekOf = currentWeekStart();
    const durationSeconds = Math.max(
      0,
      Math.round((intent.finishedAt - intent.startedAt) / 1000)
    );

    // §6.2: arcade earnings count toward the same rolling 60-minute budget as
    // every other minigame, so sum all of the winner's recent sessions.
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const hourly = await prisma.minigameSession.aggregate({
      where: { userId: winnerId, completedAt: { gte: oneHourAgo } },
      _sum: { coinsEarned: true },
    });
    const hourlyHeadroom = Math.max(0, ARCADE_HOURLY_COIN_LIMIT - (hourly._sum?.coinsEarned ?? 0));

    const result = await prisma.$transaction<ArcadeSettlement>(async (tx) => {
      let capRecord = await tx.weeklyEarningsCap.findUnique({
        where: {
          userId_gameType_weekOf: { userId: winnerId, gameType: ARCADE_GAME_TYPE, weekOf },
        },
      });

      if (!capRecord) {
        capRecord = await tx.weeklyEarningsCap.create({
          data: { userId: winnerId, gameType: ARCADE_GAME_TYPE, earned: 0, weekOf },
        });
      }

      const weeklySpace = Math.max(0, ARCADE_WEEKLY_COIN_CAP - capRecord.earned);
      const coinsAwarded = Math.min(ARCADE_WIN_COINS, weeklySpace, hourlyHeadroom);
      const freshResult: ArcadeSettlement = {
        matchId,
        winnerId,
        isDraw: false,
        coinsAwarded,
        weeklyRemaining: Math.max(0, weeklySpace - coinsAwarded),
      };

      // Claim before crediting: if an earlier attempt already paid, replay its
      // numbers. The claim shares this transaction with the credit below, so a
      // payout can never be marked settled while the coins fail to land.
      const replay = await this.claimPayout(tx, intent, freshResult);
      if (replay) return replay;

      if (coinsAwarded > 0) {
        await tx.user.update({
          where: { id: winnerId },
          data: { havenCoins: { increment: coinsAwarded } },
        });

        await tx.weeklyEarningsCap.update({
          where: { id: capRecord.id },
          data: { earned: { increment: coinsAwarded } },
        });
      }

      await tx.minigameSession.create({
        data: {
          userId: winnerId,
          gameType: ARCADE_GAME_TYPE,
          coinsEarned: coinsAwarded,
          score: 100,
          duration: durationSeconds,
        },
      });

      return freshResult;
    });

    this.settlements.set(matchId, result);
    this.pendingSettlements.delete(matchId);
    return result;
  }

  /**
   * Writes the durable "this finished match still owes a payout" row the moment
   * the board is decided (§6.3). Best-effort on purpose: play must keep flowing
   * when the database is unhappy, and this process's retry queue still covers
   * the outage. Returns whether the row landed.
   */
  static async recordOwedPayout(match: ConnectFourMatch): Promise<boolean> {
    if (match.status !== 'FINISHED') return false;
    try {
      await prisma.arcadeSettlementOutbox.upsert({
        where: { matchId: match.id },
        create: {
          matchId: match.id,
          gameType: ARCADE_GAME_TYPE,
          cabinetId: match.cabinetId,
          player1Id: match.player1Id,
          player2Id: match.player2Id,
          winnerId: match.winnerId,
          isDraw: match.isDraw,
          startedAt: new Date(match.createdAt),
        },
        update: { winnerId: match.winnerId, isDraw: match.isDraw },
      });
      return true;
    } catch (err: any) {
      console.error(`[Arcade] Could not record owed payout for ${match.id}:`, err?.message ?? err);
      return false;
    }
  }

  /**
   * Replays every payout the database still shows as owed. Runs at boot, before
   * anyone can connect, so a crash or restart between "board decided" and
   * "coins credited" costs a winner nothing. Best-effort: never throws, and one
   * unpaysable row cannot block the rest.
   */
  static async recoverPendingSettlements(): Promise<ArcadeSettlement[]> {
    let rows: ArcadeSettlementOutbox[];
    try {
      rows = await prisma.arcadeSettlementOutbox.findMany({
        where: { settledAt: null },
        orderBy: { finishedAt: 'asc' },
      });
    } catch (err: any) {
      console.error('[Arcade] Could not load owed payouts:', err?.message ?? err);
      return [];
    }

    const settled: ArcadeSettlement[] = [];
    for (const row of rows) {
      try {
        settled.push(await this.payOutboxEntry(this.intentFromRow(row)));
      } catch (err: any) {
        console.error(`[Arcade] Recovery could not settle ${row.matchId}:`, err?.message ?? err);
      }
    }
    if (settled.length > 0) {
      console.log(`[Arcade] Recovered ${settled.length} unpaid arcade payout(s) on startup`);
    }
    return settled;
  }

  /** Records why a payout attempt failed so an owed row can be diagnosed (§6.3). */
  static async markSettlementAttemptFailed(matchId: string, message: string): Promise<void> {
    try {
      await prisma.arcadeSettlementOutbox.updateMany({
        where: { matchId, settledAt: null },
        data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
      });
    } catch {
      // Diagnostics only — a failed annotation must not mask the real error.
    }
  }


  /** Rebuilds a settlement intent from its outbox row (used by boot recovery). */
  private static intentFromRow(row: ArcadeSettlementOutbox): ArcadeSettlementIntent {
    return {
      matchId: row.matchId,
      cabinetId: row.cabinetId,
      player1Id: row.player1Id,
      player2Id: row.player2Id,
      winnerId: row.winnerId,
      isDraw: row.isDraw,
      startedAt: row.startedAt.getTime(),
      finishedAt: row.finishedAt.getTime(),
    };
  }

  /** The result stored for a settled match, so a replay reports what it paid. */
  private static storedResult(row: ArcadeSettlementOutbox): ArcadeSettlement {
    return {
      matchId: row.matchId,
      winnerId: row.winnerId,
      isDraw: row.isDraw,
      coinsAwarded: row.coinsAwarded,
      weeklyRemaining: row.weeklyRemaining,
    };
  }

  /**
   * Takes ownership of a match's payout inside the settlement transaction.
   * Returns null when this call won the claim (the row now records the result),
   * or the stored result when the row was already settled — which is how a
   * restart or a replayed broadcast pays nothing a second time.
   */
  private static async claimPayout(
    tx: Prisma.TransactionClient,
    intent: ArcadeSettlementIntent,
    result: ArcadeSettlement
  ): Promise<ArcadeSettlement | null> {
    // Guarantee an intent row exists, even if the finish-time write never landed.
    await tx.arcadeSettlementOutbox.upsert({
      where: { matchId: intent.matchId },
      create: {
        matchId: intent.matchId,
        gameType: ARCADE_GAME_TYPE,
        cabinetId: intent.cabinetId,
        player1Id: intent.player1Id,
        player2Id: intent.player2Id,
        winnerId: intent.winnerId,
        isDraw: intent.isDraw,
        startedAt: new Date(intent.startedAt),
        finishedAt: new Date(intent.finishedAt),
      },
      // An existing row keeps its own history; only the "create if missing"
      // half of the upsert matters here, so the update writes a constant.
      update: { gameType: ARCADE_GAME_TYPE },
    });

    const claimed = await tx.arcadeSettlementOutbox.updateMany({
      where: { matchId: intent.matchId, settledAt: null },
      data: {
        settledAt: new Date(),
        coinsAwarded: result.coinsAwarded,
        weeklyRemaining: result.weeklyRemaining,
        lastError: null,
      },
    });
    if (claimed.count === 1) return null;

    const row = await tx.arcadeSettlementOutbox.findUnique({ where: { matchId: intent.matchId } });
    if (!row) throw new Error(`Arcade settlement ${intent.matchId} vanished mid-transaction`);
    return this.storedResult(row);
  }


  /**
   * Records that a finished match still owes its payout, so a failed settlement
   * attempt gets retried instead of lost. Safe to call repeatedly.
   */
  static queueSettlementRetry(matchId: string): void {
    const match = this.matches.get(matchId);
    if (match?.status === 'FINISHED' && !this.settlements.has(matchId)) {
      this.pendingSettlements.add(matchId);
    }
  }

  /**
   * Queues every finished-but-unpaid match. Covers payouts dropped when a
   * player's socket died before the settlement continuation could run: the board
   * says the match is over, so the coins are still owed.
   */
  static queueUnsettledFinishedMatches(): void {
    for (const match of this.matches.values()) {
      if (match.status === 'FINISHED' && !this.settlements.has(match.id)) {
        this.pendingSettlements.add(match.id);
      }
    }
  }

  static pendingSettlementCount(): number {
    return this.pendingSettlements.size;
  }

  /**
   * Forgets matches that are over *and* already paid once they go stale, so the
   * match/settlement maps and the payout sweep stay bounded on a long-lived
   * server. Anything still owed is kept — pruning must never drop a payout.
   */
  static pruneFinishedMatches(now = Date.now()): number {
    let removed = 0;
    for (const [matchId, match] of this.matches) {
      if (match.status !== 'FINISHED' || !this.settlements.has(matchId)) continue;
      if (now - match.createdAt <= ARCADE_MATCH_RETENTION_MS) continue;
      this.matches.delete(matchId);
      this.settlements.delete(matchId);
      this.pendingSettlements.delete(matchId);
      removed++;
    }
    return removed;
  }

  /**
   * Retries each queued payout exactly once. Anything that still fails stays
   * queued for the next sweep, and settleMatch's own cache keeps a retry from
   * ever paying twice. Never throws, so a timer can call it directly.
   */
  static async settlePendingMatches(): Promise<ArcadeSettlement[]> {
    const settled: ArcadeSettlement[] = [];
    for (const matchId of Array.from(this.pendingSettlements)) {
      try {
        settled.push(await this.settleMatch(matchId));
      } catch (err: any) {
        console.error(`[Arcade] Settlement retry failed for ${matchId}:`, err?.message ?? err);
        await this.markSettlementAttemptFailed(matchId, String(err?.message ?? err));
      }
    }
    return settled;
  }

  /**
   * Checks if placing a piece at (row, col) creates 4 in a row in any direction
   */
  private static checkWin(board: number[][], row: number, col: number, disc: number): boolean {
    const directions = [
      [0, 1],  // Horizontal
      [1, 0],  // Vertical
      [1, 1],  // Diagonal \
      [1, -1], // Diagonal /
    ];

    for (const [dr, dc] of directions) {
      let count = 1;

      // Count positive direction
      for (let step = 1; step <= 3; step++) {
        const r = row + dr * step;
        const c = col + dc * step;
        if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === disc) {
          count++;
        } else {
          break;
        }
      }

      // Count negative direction
      for (let step = 1; step <= 3; step++) {
        const r = row - dr * step;
        const c = col - dc * step;
        if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === disc) {
          count++;
        } else {
          break;
        }
      }

      if (count >= 4) return true;
    }

    return false;
  }
}
