import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { registerSocketHandlers, flushArcadeSettlements } from '../index';
import { prisma } from '../../prisma';
import {
  ArcadeService,
  ARCADE_GAME_TYPE,
  ARCADE_WIN_COINS,
  ARCADE_WEEKLY_COIN_CAP,
} from '../../services/ArcadeService';
import { createTestUser, createTestRoom, defaultTestAvatar } from '../../../__tests__/helpers/factories';
import { createAuthenticatedSocket, waitForEvent, closeAllSockets } from '../../../__tests__/helpers/socketHelpers';

// The socket layer touches Redis only for online-user tracking (sAdd/sRem),
// which the Connect-4 payout path does not depend on. Faking it keeps this
// suite runnable with nothing but the test database.
jest.mock('../../redis', () => ({
  redis: {
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    sIsMember: jest.fn().mockResolvedValue(false),
    isOpen: true,
  },
  connectRedis: jest.fn().mockResolvedValue(undefined),
  redisClient: {},
}));

/**
 * Connect-4 over real sockets (GDD §6.3): two roommates play a full match and
 * the server pays the winner. Kept in the unit project so it runs anywhere the
 * test database does — unlike the integration project it needs no Redis.
 */
describe('Arcade Connect-4 socket payouts', () => {
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: SocketIOServer;
  let serverUrl: string;
  let sockets: Socket[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    registerSocketHandlers(ioServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    serverUrl = `http://localhost:${(httpServer.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    await closeAllSockets(sockets);
    sockets = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    ioServer.close();
    if (createdUserIds.length > 0) {
      await prisma.room.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  async function makeUser(havenCoins = 500) {
    const user = await createTestUser({ havenCoins });
    createdUserIds.push(user.id);
    return user;
  }

  async function joinRoom(user: { id: string; username: string }, roomId: string): Promise<Socket> {
    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId,
      player: {
        id: user.id,
        username: user.username,
        x: 0,
        y: 0,
        z: 0,
        rotY: 0,
        direction: 'down',
        isMoving: false,
        avatar: defaultTestAvatar,
      },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE, 5000);
    return socket;
  }

  /**
   * Resolves on the broadcast for one specific move. Both roommates hear every
   * move, so the first ARCADE_STATE to arrive is not necessarily the one this
   * client just caused — match it on how many discs are now on the board.
   */
  function waitForMove(socket: Socket, matchId: string, col: number, piecesAfter: number): Promise<any> {
    const event = SOCKET_EVENTS.ARCADE_STATE;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`Timed out waiting for the drop on column ${col}`));
      }, 5000);

      function handler(state: any) {
        if (state?.id !== matchId) return;
        const pieces = state.board.flat().filter((cell: number) => cell !== 0).length;
        if (pieces !== piecesAfter) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(state);
      }

      socket.on(event, handler);
    });
  }

  /** Subscribes before emitting so the room broadcast can never be missed. */
  function drop(socket: Socket, matchId: string, col: number, piecesAfter: number): Promise<any> {
    const state = waitForMove(socket, matchId, col, piecesAfter);
    socket.emit(SOCKET_EVENTS.ARCADE_MOVE, { matchId, col });
    return state;
  }

  /** Opens a cabinet and returns its opening broadcast. */
  async function startMatch(socket: Socket, opponentId: string, cabinetId: string) {
    const broadcast = waitForEvent(socket, SOCKET_EVENTS.ARCADE_STATE, 5000);
    socket.emit(SOCKET_EVENTS.ARCADE_START, { opponentId, cabinetId });
    return broadcast;
  }
  /**
   * Drops every arcade match this process remembers, the way a restart would:
   * anything the outbox does not know about is gone for good.
   */
  function forgetArcadeMemory(): void {
    const internals = ArcadeService as unknown as {
      matches: Map<string, unknown>;
      settlements: Map<string, unknown>;
      pendingSettlements: Set<string>;
    };
    internals.matches.clear();
    internals.settlements.clear();
    internals.pendingSettlements.clear();
  }


  it('pays the winner over the socket and persists the award', async () => {
    const winner = await makeUser();
    const loser = await makeUser();
    const room = await createTestRoom(winner.id);

    const winnerSocket = await joinRoom(winner, room.id);
    const loserSocket = await joinRoom(loser, room.id);

    const match = await startMatch(winnerSocket, loser.id, 'cab-payout');
    expect(match.player1Id).toBe(winner.id);
    expect(match.currentTurn).toBe(winner.id);

    // Player 1 stacks column 0 while player 2 obligingly fills column 1.
    const openingMoves: Array<[Socket, number]> = [
      [winnerSocket, 0], [loserSocket, 1],
      [winnerSocket, 0], [loserSocket, 1],
      [winnerSocket, 0], [loserSocket, 1],
    ];
    for (let i = 0; i < openingMoves.length; i++) {
      const [socket, col] = openingMoves[i];
      await drop(socket, match.id, col, i + 1);
    }

    const settlement = waitForEvent(winnerSocket, SOCKET_EVENTS.ARCADE_RESULT, 8000);
    const finalState = await drop(winnerSocket, match.id, 0, 7);
    expect(finalState.status).toBe('FINISHED');
    expect(finalState.winnerId).toBe(winner.id);

    await expect(settlement).resolves.toMatchObject({
      matchId: match.id,
      winnerId: winner.id,
      isDraw: false,
      coinsAwarded: ARCADE_WIN_COINS,
      weeklyRemaining: ARCADE_WEEKLY_COIN_CAP - ARCADE_WIN_COINS,
    });

    // The socket payout and the database must agree — no client-side math.
    const [dbWinner, sessions, cap, dbLoser] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: winner.id }, select: { havenCoins: true } }),
      prisma.minigameSession.findMany({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
      prisma.weeklyEarningsCap.findFirst({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
      prisma.user.findUniqueOrThrow({ where: { id: loser.id }, select: { havenCoins: true } }),
    ]);
    expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].coinsEarned).toBe(ARCADE_WIN_COINS);
    expect(cap?.earned).toBe(ARCADE_WIN_COINS);
    // Losing pays nothing.
    expect(dbLoser.havenCoins).toBe(500);
  });

  it('reaches both players when one of them changes rooms mid-match', async () => {
    const winner = await makeUser();
    const loser = await makeUser();
    const room = await createTestRoom(winner.id);
    const otherRoom = await createTestRoom(loser.id);

    const winnerSocket = await joinRoom(winner, room.id);
    const loserSocket = await joinRoom(loser, room.id);

    const match = await startMatch(winnerSocket, loser.id, 'cab-crossroom');
    const openingMoves: Array<[Socket, number]> = [
      [winnerSocket, 0], [loserSocket, 1],
      [winnerSocket, 0], [loserSocket, 1],
      [winnerSocket, 0], [loserSocket, 1],
    ];
    for (let i = 0; i < openingMoves.length; i++) {
      const [socket, col] = openingMoves[i];
      await drop(socket, match.id, col, i + 1);
    }

    // The loser walks out to another loft while the match is still live.
    loserSocket.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId: otherRoom.id });
    await waitForEvent(loserSocket, SOCKET_EVENTS.ROOM_STATE, 5000);

    const winnerSettlement = waitForEvent(winnerSocket, SOCKET_EVENTS.ARCADE_RESULT, 8000);
    const loserSettlement = waitForEvent(loserSocket, SOCKET_EVENTS.ARCADE_RESULT, 8000);
    await drop(winnerSocket, match.id, 0, 7);

    // Both room instances must see the payout, not just the mover's room.
    await expect(winnerSettlement).resolves.toMatchObject({ winnerId: winner.id, coinsAwarded: ARCADE_WIN_COINS });
    await expect(loserSettlement).resolves.toMatchObject({ winnerId: winner.id, coinsAwarded: ARCADE_WIN_COINS });
  });

  it('refuses a second live match on the same cabinet', async () => {
    const playerA = await makeUser();
    const playerB = await makeUser();
    const playerC = await makeUser();
    const room = await createTestRoom(playerA.id);

    const socketA = await joinRoom(playerA, room.id);
    await joinRoom(playerB, room.id);
    const socketC = await joinRoom(playerC, room.id);

    await startMatch(socketA, playerB.id, 'cab-busy');

    const rejection = waitForEvent(socketC, SOCKET_EVENTS.ERROR, 5000);
    socketC.emit(SOCKET_EVENTS.ARCADE_START, { opponentId: playerA.id, cabinetId: 'cab-busy' });
    const err = await rejection;
    expect(err.code).toBe('ARCADE_ERROR');
    expect(err.message).toMatch(/already running a match/i);

    // A free cabinet is still usable, so the guard is per-prop, not global.
    await expect(startMatch(socketC, playerA.id, 'cab-free')).resolves.toMatchObject({
      cabinetId: 'cab-free',
    });
  });

  it('settles a replayed final move exactly once', async () => {
    const winner = await makeUser();
    const loser = await makeUser();
    const room = await createTestRoom(winner.id);

    const winnerSocket = await joinRoom(winner, room.id);
    const loserSocket = await joinRoom(loser, room.id);

    const match = await startMatch(winnerSocket, loser.id, 'cab-replay');
    const openingMoves: Array<[Socket, number]> = [
      [winnerSocket, 0], [loserSocket, 1],
      [winnerSocket, 0], [loserSocket, 1],
      [winnerSocket, 0], [loserSocket, 1],
    ];
    for (let i = 0; i < openingMoves.length; i++) {
      const [socket, col] = openingMoves[i];
      await drop(socket, match.id, col, i + 1);
    }
    await drop(winnerSocket, match.id, 0, 7);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Replaying the winning move must neither settle nor pay a second time.
    winnerSocket.emit(SOCKET_EVENTS.ARCADE_MOVE, { matchId: match.id, col: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(ArcadeService.settleMatch(match.id)).resolves.toMatchObject({
      coinsAwarded: ARCADE_WIN_COINS,
    });

    const [dbWinner, sessionCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: winner.id }, select: { havenCoins: true } }),
      prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
    ]);
    expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    expect(sessionCount).toBe(1);
  });

  it('pays a match whose settlement never ran (socket died mid-payout)', async () => {
    const winner = await makeUser();
    const loser = await makeUser();
    const room = await createTestRoom(winner.id);

    const winnerSocket = await joinRoom(winner, room.id);
    const loserSocket = await joinRoom(loser, room.id);
    const match = await startMatch(winnerSocket, loser.id, 'cab-sweep');

    // Decide the board straight through the service: this is the state left behind
    // when the socket carrying ARCADE_MOVE dies before its settlement continuation
    // runs — the match is FINISHED and the server still owes the winner 40 coins.
    for (let i = 0; i < 3; i++) {
      ArcadeService.makeMove(match.id, winner.id, 0);
      ArcadeService.makeMove(match.id, loser.id, 1);
    }
    ArcadeService.makeMove(match.id, winner.id, 0);
    expect(ArcadeService.getMatch(match.id)?.status).toBe('FINISHED');
    expect(
      await prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } })
    ).toBe(0);

    const winnerResult = waitForEvent(winnerSocket, SOCKET_EVENTS.ARCADE_RESULT, 8000);
    const loserResult = waitForEvent(loserSocket, SOCKET_EVENTS.ARCADE_RESULT, 8000);
    await flushArcadeSettlements(ioServer);

    await expect(winnerResult).resolves.toMatchObject({
      matchId: match.id,
      winnerId: winner.id,
      coinsAwarded: ARCADE_WIN_COINS,
    });
    // The sweep broadcasts to both players, not only the winner's room.
    await expect(loserResult).resolves.toMatchObject({ winnerId: winner.id });

    const [dbWinner, sessionCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: winner.id }, select: { havenCoins: true } }),
      prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
    ]);
    expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    expect(sessionCount).toBe(1);

    // Sweeping again owes nothing: a retry can never pay the same win twice.
    await flushArcadeSettlements(ioServer);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [afterRetry, sessionsAfterRetry] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: winner.id }, select: { havenCoins: true } }),
      prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
    ]);
    expect(afterRetry.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    expect(sessionsAfterRetry).toBe(1);
  });

  it('pays a match the process died before crediting (restart recovery)', async () => {
    const winner = await makeUser();
    const loser = await makeUser();
    const room = await createTestRoom(winner.id);

    const winnerSocket = await joinRoom(winner, room.id);
    const loserSocket = await joinRoom(loser, room.id);
    const match = await startMatch(winnerSocket, loser.id, 'cab-restart');

    for (let i = 0; i < 3; i++) {
      ArcadeService.makeMove(match.id, winner.id, 0);
      ArcadeService.makeMove(match.id, loser.id, 1);
    }
    const decided = ArcadeService.makeMove(match.id, winner.id, 0);
    expect(decided.status).toBe('FINISHED');

    // The move handler's durable step: the debt is on disk before any coin moves.
    // Wiping memory first means nothing in this process can settle it — the
    // sweep has no match to notice, so only a boot-time replay can pay it.
    forgetArcadeMemory();
    await expect(ArcadeService.recordOwedPayout(decided)).resolves.toBe(true);
    expect(
      await prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } })
    ).toBe(0);
    expect(ArcadeService.getMatch(match.id)).toBeNull();

    // A fresh process replays what the database says is owed — no live match,
    // no sockets, no in-memory idempotency cache to lean on.
    const recovered = await ArcadeService.recoverPendingSettlements();
    expect(recovered.find((s) => s.matchId === match.id)).toMatchObject({
      matchId: match.id,
      winnerId: winner.id,
      isDraw: false,
      coinsAwarded: ARCADE_WIN_COINS,
    });

    const [dbWinner, sessionCount, outboxRow] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: winner.id }, select: { havenCoins: true } }),
      prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
      prisma.arcadeSettlementOutbox.findUnique({ where: { matchId: match.id } }),
    ]);
    expect(dbWinner.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    expect(sessionCount).toBe(1);
    expect(outboxRow?.settledAt).not.toBeNull();
    expect(outboxRow?.coinsAwarded).toBe(ARCADE_WIN_COINS);

    // Restarting again must find nothing owed and pay nothing a second time.
    forgetArcadeMemory();
    await expect(ArcadeService.recoverPendingSettlements()).resolves.toEqual([]);
    const [afterSecondBoot, sessionsAfterSecondBoot] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: winner.id }, select: { havenCoins: true } }),
      prisma.minigameSession.count({ where: { userId: winner.id, gameType: ARCADE_GAME_TYPE } }),
    ]);
    expect(afterSecondBoot.havenCoins).toBe(500 + ARCADE_WIN_COINS);
    expect(sessionsAfterSecondBoot).toBe(1);
  });

});
