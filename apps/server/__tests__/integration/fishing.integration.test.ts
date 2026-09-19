import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO, Socket } from 'socket.io-client';
import { app } from '../../src/index';
import { registerSocketHandlers } from '../../src/sockets';
import { FishingService } from '../../src/services/FishingService';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestRoom, defaultTestAvatar } from '../helpers/factories';
import { createAuthenticatedSocket, waitForEvent, closeAllSockets } from '../helpers/socketHelpers';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { SOCKET_EVENTS } from '@havenworld/shared';

describe('Fishing Mini-Game Integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: SocketIOServer;
  let serverUrl: string;
  let sockets: Socket[] = [];

  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    registerSocketHandlers(ioServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const addr = httpServer.address() as { port: number };
    serverUrl = `http://localhost:${addr.port}`;
  });

  afterEach(async () => {
    await closeAllSockets(sockets);
    sockets = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    ioServer.close();
    await truncateAllTables();
  });

  it('should receive FISH_BITE event after casting line', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);

    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user.id, username: user.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE);

    socket.emit(SOCKET_EVENTS.CAST_LINE, { roomId: room.id });

    const bite = await waitForEvent(socket, SOCKET_EVENTS.FISH_BITE, 5000);
    expect(bite).toBeDefined();
    expect(bite).toHaveProperty('species');
    expect(bite).toHaveProperty('difficulty');

    FishingService.cancelSession(user.id);
  });

  it('should stream TENSION_UPDATE events during active fishing', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);

    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user.id, username: user.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE);

    socket.emit(SOCKET_EVENTS.CAST_LINE, { roomId: room.id });
    await waitForEvent(socket, SOCKET_EVENTS.FISH_BITE, 5000);

    const tensionUpdate = await waitForEvent(socket, SOCKET_EVENTS.TENSION_UPDATE, 5000);
    expect(tensionUpdate).toBeDefined();
    expect(typeof tensionUpdate.value).toBe('number');
    expect(typeof tensionUpdate.sweetSpotMin).toBe('number');
    expect(typeof tensionUpdate.sweetSpotMax).toBe('number');

    FishingService.cancelSession(user.id);
  });

  it('should award coins and persist fish catch on successful catch', async () => {
    const user = await createTestUser({ havenCoins: 100 });
    const room = await createTestRoom(user.id);

    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user.id, username: user.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE);

    socket.emit(SOCKET_EVENTS.CAST_LINE, { roomId: room.id });
    await waitForEvent(socket, SOCKET_EVENTS.FISH_BITE, 5000);

    // Keep reel in sweet spot by reading tension update and updating position
    const caughtPromise = waitForEvent(socket, SOCKET_EVENTS.FISH_CAUGHT, 10000);

    const listener = (data: any) => {
      const mid = (data.sweetSpotMin + data.sweetSpotMax) / 2;
      socket.emit(SOCKET_EVENTS.REEL_POSITION, { value: mid });
    };
    socket.on(SOCKET_EVENTS.TENSION_UPDATE, listener);

    const caught = await caughtPromise;
    socket.off(SOCKET_EVENTS.TENSION_UPDATE, listener);

    expect(caught).toBeDefined();
    expect(caught.coinsEarned).toBeGreaterThan(0);

    // Verify DB record
    const record = await prisma.fishCatch.findFirst({ where: { userId: user.id } });
    expect(record).toBeDefined();
    expect(record?.species).toBe(caught.species);

    // Verify user coins increased
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.havenCoins).toBeGreaterThan(100);
  });

  it('should emit FISH_ESCAPED when tension drops to zero', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);

    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user.id, username: user.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE);

    socket.emit(SOCKET_EVENTS.CAST_LINE, { roomId: room.id });
    await waitForEvent(socket, SOCKET_EVENTS.FISH_BITE, 5000);

    // Move reel away from sweet spot (tension will drain to 0)
    socket.emit(SOCKET_EVENTS.REEL_POSITION, { value: 0.0 });

    const escaped = await waitForEvent(socket, SOCKET_EVENTS.FISH_ESCAPED, 10000);
    expect(escaped).toBeDefined();
  });

  it('should cancel active fishing session when CANCEL_FISHING is sent', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);

    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user.id, username: user.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE);

    socket.emit(SOCKET_EVENTS.CAST_LINE, { roomId: room.id });
    await waitForEvent(socket, SOCKET_EVENTS.FISH_BITE, 5000);

    socket.emit(SOCKET_EVENTS.CANCEL_FISHING);
    await new Promise((r) => setTimeout(r, 300));

    // Verify session cancelled
    expect(FishingService['activeSessions'].has(user.id)).toBe(false);
  });

  it('should record catches on the weekly fishing leaderboard', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);

    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user.id, username: user.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar },
    });
    await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE);

    socket.emit(SOCKET_EVENTS.CAST_LINE, { roomId: room.id });
    await waitForEvent(socket, SOCKET_EVENTS.FISH_BITE, 5000);

    const caughtPromise = waitForEvent(socket, SOCKET_EVENTS.FISH_CAUGHT, 10000);
    const listener = (data: any) => {
      socket.emit(SOCKET_EVENTS.REEL_POSITION, { value: (data.sweetSpotMin + data.sweetSpotMax) / 2 });
    };
    socket.on(SOCKET_EVENTS.TENSION_UPDATE, listener);

    await caughtPromise;
    socket.off(SOCKET_EVENTS.TENSION_UPDATE, listener);

    const leaderboard = await prisma.fishingLeaderboard.findFirst({ where: { userId: user.id } });
    expect(leaderboard).toBeDefined();
    expect(leaderboard?.weightLbs).toBeGreaterThan(0);
  });
});
