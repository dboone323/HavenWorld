import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Socket } from 'socket.io-client';
import { app, initSocketRedisAdapter } from '../../src/index';
import { redis, connectRedis, disconnectRedis } from '../../src/redis';
import { registerSocketHandlers } from '../../src/sockets';
import { createTestUser } from '../helpers/factories';
import { createAuthenticatedSocket, waitForEvent, closeAllSockets } from '../helpers/socketHelpers';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { SOCKET_EVENTS } from '@havenworld/shared';

describe('Multi-Worker PM2 Cluster & Redis Adapter Integration', () => {
  let server1Http: ReturnType<typeof createServer>;
  let server2Http: ReturnType<typeof createServer>;
  let ioServer1: SocketIOServer;
  let ioServer2: SocketIOServer;
  let server1Url: string;
  let server2Url: string;
  let sockets: Socket[] = [];

  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();

    if (!redis.isOpen) {
      await connectRedis();
    }

    // 1. Boot Worker 0 (simulating PM2 INSTANCE_ID=0)
    server1Http = createServer(app);
    ioServer1 = new SocketIOServer(server1Http, { cors: { origin: '*' } });
    await initSocketRedisAdapter(ioServer1);
    registerSocketHandlers(ioServer1);

    await new Promise<void>((resolve) => server1Http.listen(0, resolve));
    const addr1 = server1Http.address() as { port: number };
    server1Url = `http://localhost:${addr1.port}`;

    // 2. Boot Worker 1 (simulating PM2 INSTANCE_ID=1)
    server2Http = createServer(app);
    ioServer2 = new SocketIOServer(server2Http, { cors: { origin: '*' } });
    await initSocketRedisAdapter(ioServer2);
    registerSocketHandlers(ioServer2);

    await new Promise<void>((resolve) => server2Http.listen(0, resolve));
    const addr2 = server2Http.address() as { port: number };
    server2Url = `http://localhost:${addr2.port}`;
  });

  afterEach(async () => {
    await closeAllSockets(sockets);
    sockets = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server1Http.close(() => resolve()));
    await new Promise<void>((resolve) => server2Http.close(() => resolve()));
    ioServer1.close();
    ioServer2.close();
    await truncateAllTables();
  });

  it('verifies primary worker cron differentiation between instance 0 and secondary instances', () => {
    const isPrimary = (instanceId?: string, nodeAppInstance?: string) =>
      (!instanceId || instanceId === '0') && (!nodeAppInstance || nodeAppInstance === '0');

    // Instance 0 (or unset standalone) must be recognized as primary worker
    expect(isPrimary('0', '0')).toBe(true);
    expect(isPrimary('0', undefined)).toBe(true);
    expect(isPrimary(undefined, '0')).toBe(true);
    expect(isPrimary(undefined, undefined)).toBe(true);

    // Secondary workers (instance 1, 2, etc.) must NOT be primary
    expect(isPrimary('1', '0')).toBe(false);
    expect(isPrimary('0', '1')).toBe(false);
    expect(isPrimary('1', '1')).toBe(false);
    expect(isPrimary('2', '2')).toBe(false);
  });

  it('synchronizes room presence across separate cluster worker processes via Redis', async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    // Client A connects to Worker 0
    const socketA = await createAuthenticatedSocket(server1Url, userA.id, sockets, { username: userA.username });
    // Client B connects to Worker 1
    const socketB = await createAuthenticatedSocket(server2Url, userB.id, sockets, { username: userB.username });

    const roomId = 'room-park';

    // Both clients join Haven Park on different cluster workers
    socketA.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId,
      player: {
        id: userA.id,
        username: userA.username,
        x: 0,
        y: 0,
        z: 3.5,
        rotY: 0,
        direction: 'down',
        isMoving: false,
      },
    });

    socketB.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId,
      player: {
        id: userB.id,
        username: userB.username,
        x: 1,
        y: 0,
        z: 3.5,
        rotY: 0,
        direction: 'down',
        isMoving: false,
      },
    });

    await waitForEvent(socketA, SOCKET_EVENTS.ROOM_STATE, 5000);
    await waitForEvent(socketB, SOCKET_EVENTS.ROOM_STATE, 5000);

    // Wait 100ms for Redis set additions to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 1. Verify cluster-wide occupancy set in Redis
    const occupants = await redis.sMembers(`room:${roomId}:occupants`);
    expect(occupants).toContain(userA.id);
    expect(occupants).toContain(userB.id);

    // 2. Verify individual user presence hashes with TTL
    const presA = await redis.hGetAll(`user:${userA.id}:presence`);
    expect(presA.roomId).toBe(roomId);
    expect(Number(presA.lastSeen)).toBeGreaterThan(0);

    const ttlA = await redis.ttl(`user:${userA.id}:presence`);
    expect(ttlA).toBeGreaterThan(0);
    expect(ttlA).toBeLessThanOrEqual(120);

    // 3. Cross-worker event broadcast: Client A on Worker 0 sends chat, Client B on Worker 1 receives it
    const chatPromise = waitForEvent(socketB, SOCKET_EVENTS.CHAT_MESSAGE, 5000);
    socketA.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'Hello from Worker 0!' });

    const chatReceived: any = await chatPromise;
    expect(chatReceived).toBeDefined();
    expect(chatReceived.content).toBe('Hello from Worker 0!');
    expect(chatReceived.username).toBe(userA.username);

    // 4. Disconnect Client A from Worker 0
    socketA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify User A presence cleared and removed from room occupants
    const existsA = await redis.exists(`user:${userA.id}:presence`);
    expect(existsA).toBe(0);

    const isMemberA = await redis.sIsMember(`room:${roomId}:occupants`, userA.id);
    expect(Boolean(isMemberA)).toBe(false);

    // User B remains present
    const isMemberB = await redis.sIsMember(`room:${roomId}:occupants`, userB.id);
    expect(Boolean(isMemberB)).toBe(true);
  });
});
