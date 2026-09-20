import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO, Socket } from 'socket.io-client';
import { app } from '../../src/index';
import { registerSocketHandlers } from '../../src/sockets';
import { createTestUser, createTestRoom } from '../helpers/factories';
import { createAuthenticatedSocket, waitForEvent, closeAllSockets } from '../helpers/socketHelpers';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { SOCKET_EVENTS } from '@havenworld/shared';

describe('Socket.io Integration — Connection & Room Flow', () => {
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: SocketIOServer;
  let serverUrl: string;
  let sockets: Socket[] = [];

  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });
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

  it('should emit connect_error AUTH_REQUIRED when connecting without an auth token', async () => {
    const socket = ClientIO(serverUrl, { auth: {}, transports: ['websocket'] });
    sockets.push(socket);

    const error: any = await waitForEvent(socket, 'connect_error');
    expect(error.message).toMatch(/AUTH_REQUIRED/);
  });

  it('should connect successfully with valid JWT', async () => {
    const user = await createTestUser();
    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });
    expect(socket.connected).toBe(true);
    expect(socket.id).toBeDefined();
  });

  it('should receive room:state with occupants when joining a valid room', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);
    const socket = await createAuthenticatedSocket(serverUrl, user.id, sockets, { username: user.username });

    socket.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: {
        id: user.id,
        username: user.username,
        x: 100,
        y: 100,
        z: 0,
        rotY: 0,
        direction: 'down',
        isMoving: false,
      },
    });

    const roomState = await waitForEvent(socket, SOCKET_EVENTS.ROOM_STATE, 5000);
    expect(roomState).toBeDefined();
    expect(roomState.roomId).toBe(room.id);
    expect(Array.isArray(roomState.players)).toBe(true);
  });

  it('should broadcast player:position when player:move is emitted', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const room = await createTestRoom(user1.id);

    const socket1 = await createAuthenticatedSocket(serverUrl, user1.id, sockets, { username: user1.username });
    const socket2 = await createAuthenticatedSocket(serverUrl, user2.id, sockets, { username: user2.username });

    // Both join the same room and wait for ROOM_STATE
    socket1.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user1.id, username: user1.username, x: 320, y: 224, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });
    socket2.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user2.id, username: user2.username, x: 325, y: 229, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });

    const [state1, state2] = await Promise.all([
      waitForEvent(socket1, SOCKET_EVENTS.ROOM_STATE, 5000),
      waitForEvent(socket2, SOCKET_EVENTS.ROOM_STATE, 5000),
    ]);

    // Extract player1's actual spawn position from ROOM_STATE
    const player1State = state1.players.find((p: any) => p.id === user1.id);
    const moveTarget = { x: player1State.x + 2, y: player1State.y + 1 };

    socket1.emit(SOCKET_EVENTS.PLAYER_MOVE, {
      roomId: room.id,
      x: moveTarget.x,
      y: moveTarget.y,
      z: 0,
      rotY: 1.2,
      direction: 'right',
      isMoving: true,
    });

    const moved = await waitForEvent(socket2, SOCKET_EVENTS.PLAYER_POSITION, 5000);
    expect(moved).toMatchObject({
      playerId: user1.id,
      x: moveTarget.x,
      y: moveTarget.y,
    });
  });

  it('should broadcast chat:message to room occupants when chat:send is emitted', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const room = await createTestRoom(user1.id);

    const socket1 = await createAuthenticatedSocket(serverUrl, user1.id, sockets, { username: user1.username });
    const socket2 = await createAuthenticatedSocket(serverUrl, user2.id, sockets, { username: user2.username });

    socket1.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user1.id, username: user1.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });
    socket2.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user2.id, username: user2.username, x: 5, y: 5, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });

    await Promise.all([
      waitForEvent(socket1, SOCKET_EVENTS.ROOM_STATE, 5000),
      waitForEvent(socket2, SOCKET_EVENTS.ROOM_STATE, 5000),
    ]);

    socket1.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'Hello HavenWorld!', roomId: room.id });

    const chat = await waitForEvent(socket2, SOCKET_EVENTS.CHAT_MESSAGE, 5000);
    expect(chat).toMatchObject({
      username: user1.username,
      content: 'Hello HavenWorld!',
    });
    expect(chat).toHaveProperty('timestamp');
  });

  it('should sanitize profanity or send chat:error when message contains profanity', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const room = await createTestRoom(user1.id);

    const socket1 = await createAuthenticatedSocket(serverUrl, user1.id, sockets, { username: user1.username });
    const socket2 = await createAuthenticatedSocket(serverUrl, user2.id, sockets, { username: user2.username });

    socket1.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user1.id, username: user1.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });
    socket2.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user2.id, username: user2.username, x: 5, y: 5, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });

    await Promise.all([
      waitForEvent(socket1, SOCKET_EVENTS.ROOM_STATE, 5000),
      waitForEvent(socket2, SOCKET_EVENTS.ROOM_STATE, 5000),
    ]);

    socket1.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'This damn game is awesome', roomId: room.id });

    const receivedChat = await waitForEvent(socket2, SOCKET_EVENTS.CHAT_MESSAGE, 5000);
    expect(receivedChat.content).toContain('*');
  });

  it('should broadcast room:player_left to remaining occupants when a client disconnects', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const room = await createTestRoom(user1.id);

    const socket1 = await createAuthenticatedSocket(serverUrl, user1.id, sockets, { username: user1.username });
    const socket2 = await createAuthenticatedSocket(serverUrl, user2.id, sockets, { username: user2.username });

    socket1.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user1.id, username: user1.username, x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });
    socket2.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user2.id, username: user2.username, x: 5, y: 5, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });

    await Promise.all([
      waitForEvent(socket1, SOCKET_EVENTS.ROOM_STATE, 5000),
      waitForEvent(socket2, SOCKET_EVENTS.ROOM_STATE, 5000),
    ]);

    const leftPromise = waitForEvent(socket2, SOCKET_EVENTS.ROOM_PLAYER_LEFT, 5000);
    socket1.disconnect();

    const left = await leftPromise;
    expect(left.playerId).toBe(user1.id);
  });

  it('should deliver position updates bidirectionally between two room occupants', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const room = await createTestRoom(user1.id);

    const socket1 = await createAuthenticatedSocket(serverUrl, user1.id, sockets, { username: user1.username });
    const socket2 = await createAuthenticatedSocket(serverUrl, user2.id, sockets, { username: user2.username });

    socket1.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user1.id, username: user1.username, x: 320, y: 224, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });
    socket2.emit(SOCKET_EVENTS.AUTH_JOIN, {
      roomId: room.id,
      player: { id: user2.id, username: user2.username, x: 325, y: 229, z: 0, rotY: 0, direction: 'down', isMoving: false },
    });

    const [state1, state2] = await Promise.all([
      waitForEvent(socket1, SOCKET_EVENTS.ROOM_STATE, 5000),
      waitForEvent(socket2, SOCKET_EVENTS.ROOM_STATE, 5000),
    ]);

    // Extract each player's actual spawn position from ROOM_STATE
    // state2 was emitted after both players joined, so it contains both
    const player1State = state2.players.find((p: any) => p.id === user1.id);
    const player2State = state2.players.find((p: any) => p.id === user2.id);

    // Player 1 moves slightly from spawn position
    socket1.emit(SOCKET_EVENTS.PLAYER_MOVE, {
      roomId: room.id,
      x: player1State.x + 2,
      y: player1State.y + 1,
      z: 0,
      rotY: 0,
      direction: 'right',
      isMoving: true,
    });
    const move1 = await waitForEvent(socket2, SOCKET_EVENTS.PLAYER_POSITION, 5000);
    expect(move1.playerId).toBe(user1.id);

    // Player 2 moves slightly from spawn position
    socket2.emit(SOCKET_EVENTS.PLAYER_MOVE, {
      roomId: room.id,
      x: player2State.x + 2,
      y: player2State.y + 1,
      z: 0,
      rotY: 0,
      direction: 'left',
      isMoving: true,
    });
    const move2 = await waitForEvent(socket1, SOCKET_EVENTS.PLAYER_POSITION, 5000);
    expect(move2.playerId).toBe(user2.id);
  });
});
