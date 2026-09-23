import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SOCKET_EVENTS } from '@shared/events';

// Mock socket.io-client with a handler map we can fire events through, so we
// can simulate the handshake window between connect() and 'connect'.
const { mockSocket, socketHandlers } = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const socketHandlers = new Map<string, Handler[]>();

  const mockSocket = {
    id: 'test-socket-id',
    connected: false,
    auth: {} as Record<string, unknown>,
    on: vi.fn((event: string, cb: Handler) => {
      const list = socketHandlers.get(event) ?? [];
      list.push(cb);
      socketHandlers.set(event, list);
      return mockSocket;
    }),
    off: vi.fn((event: string, cb?: Handler) => {
      if (!cb) {
        socketHandlers.delete(event);
      } else {
        socketHandlers.set(
          event,
          (socketHandlers.get(event) ?? []).filter((h) => h !== cb)
        );
      }
      return mockSocket;
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(() => {
      mockSocket.connected = false;
    }),
    removeAllListeners: vi.fn(() => socketHandlers.clear()),
    fire: (event: string, ...args: unknown[]) => {
      for (const handler of [...(socketHandlers.get(event) ?? [])]) {
        handler(...args);
      }
    },
  };

  return { mockSocket, socketHandlers };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

type SocketServiceModule = typeof import('../socket');
type SocketService = SocketServiceModule['socketService'];

/**
 * The service keeps module-level state (pending queue, handler registry), so
 * each test gets a fresh module instance.
 */
async function loadService(): Promise<SocketService> {
  vi.resetModules();
  const mod = await import('../socket');
  return mod.socketService;
}

/** Mark the handshake complete and fire socket.io's 'connect'. */
function completeHandshake(): void {
  mockSocket.connected = true;
  mockSocket.fire('connect');
}

describe('socketService (services/socket.ts)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();
    mockSocket.connected = false;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('(a) emits fired before the handshake completes are queued, then flushed in order on connect', async () => {
    const service = await loadService();

    service.connect(); // socket created, still connecting
    expect(mockSocket.connected).toBe(false);

    // This is the exact RoomScene sequence that used to drop AUTH_JOIN.
    service.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId: 'room-1' });
    service.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'hello' });

    expect(mockSocket.emit).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`queueing emit('${SOCKET_EVENTS.AUTH_JOIN}')`)
    );

    completeHandshake();

    expect(mockSocket.emit).toHaveBeenNthCalledWith(1, SOCKET_EVENTS.AUTH_JOIN, { roomId: 'room-1' });
    expect(mockSocket.emit).toHaveBeenNthCalledWith(2, SOCKET_EVENTS.CHAT_SEND, { content: 'hello' });
  });

  it('(b) a listener registered BEFORE connect() still receives events (ChatOverlay ordering)', async () => {
    const service = await loadService();
    const seen: string[] = [];

    // ChatOverlay is constructed before RoomScene calls connect().
    const unsub = service.on<{ text: string }>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
      seen.push(msg.text);
    });

    service.connect();
    completeHandshake();

    mockSocket.fire(SOCKET_EVENTS.CHAT_MESSAGE, { text: 'hello' });
    expect(seen).toEqual(['hello']);

    unsub();
    mockSocket.fire(SOCKET_EVENTS.CHAT_MESSAGE, { text: 'ignored' });
    expect(seen).toEqual(['hello']);
  });

  it('(c) registered listeners survive a stale-socket teardown and reconnect', async () => {
    const service = await loadService();
    const seen: string[] = [];

    service.on<{ text: string }>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
      seen.push(msg.text);
    });
    service.connect();
    completeHandshake();

    // Socket drops, then connect() is called again: the old socket is torn
    // down with removeAllListeners() and replaced.
    mockSocket.connected = false;
    service.connect();
    completeHandshake();

    mockSocket.fire(SOCKET_EVENTS.CHAT_MESSAGE, { text: 'after-reconnect' });
    expect(seen).toEqual(['after-reconnect']);
  });

  it('(d) queue is bounded — emits beyond the cap are dropped with a warning', async () => {
    const service = await loadService();
    service.connect();

    for (let i = 0; i < 51; i++) {
      service.emit(SOCKET_EVENTS.CHAT_SEND, { i });
    }

    completeHandshake();

    expect(mockSocket.emit).toHaveBeenCalledTimes(50);
    expect(mockSocket.emit).toHaveBeenLastCalledWith(SOCKET_EVENTS.CHAT_SEND, { i: 49 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dropped — queue full')
    );
  });

  it('(e) disconnect() clears the queue so nothing leaks across a logout', async () => {
    const service = await loadService();
    service.connect();

    service.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId: 'stale-room' });
    service.disconnect();

    // A new session connects — the stale AUTH_JOIN must not be replayed.
    service.connect();
    completeHandshake();

    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('(f) emits go straight through once connected (no queuing)', async () => {
    const service = await loadService();
    service.connect();
    completeHandshake();

    service.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'hi' });

    expect(mockSocket.emit).toHaveBeenCalledWith(SOCKET_EVENTS.CHAT_SEND, { content: 'hi' });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
