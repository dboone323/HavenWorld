import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketService, NotAuthenticatedError } from '../socketService';

// Mock the entire socket.io-client module. The mock socket is created with
// vi.hoisted so the module factory and these tests share one typed instance.
const { mockSocket } = vi.hoisted(() => ({
  mockSocket: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    connected: false as boolean,
    auth: {} as Record<string, unknown>,
  },
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { io as mockIo } from 'socket.io-client';

describe('SocketService', () => {
  let service: SocketService;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockSocket as any).connected = false;

    // By default, successful connection triggers WELCOME
    (mockSocket.connect as any).mockImplementation(() => {
      (mockSocket as any).connected = true;
      const welcomeHandler = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls
        .find(([event]) => event === 'WELCOME')?.[1];
      welcomeHandler?.();
    });

    service = new SocketService();
  });

  it('(a) connect() with valid token → socket.connect() called with auth', async () => {
    await service.connect('valid.jwt.token');
    expect(mockSocket.connect).toHaveBeenCalled();
    // Token must be passed in the auth handshake, not a query param
    expect(mockSocket.auth).toMatchObject({ token: 'valid.jwt.token' });
  });

  it('(b) connect() with no token → throws NotAuthenticatedError', async () => {
    await expect(service.connect('')).rejects.toThrow(NotAuthenticatedError);
    expect(mockSocket.connect).not.toHaveBeenCalled();
  });

  it('(c) Reconnection: on disconnect → exponential backoff attempted', async () => {
    vi.useFakeTimers();
    await service.connect('valid.jwt.token');

    // Simulate disconnect event from socket.io
    const disconnectHandler = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls
      .find(([event]) => event === 'disconnect')?.[1];

    disconnectHandler?.('transport error');

    // First backoff: 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockSocket.connect).toHaveBeenCalledTimes(2);

    // Second backoff: 2000ms (exponential)
    disconnectHandler?.('transport error');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockSocket.connect).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('(d) emit() before connect → event queued, sent on connect', async () => {
    // Do NOT call connect() — socket is not yet established
    service.emit('PLAYER_MOVED', { x: 1, y: 0, z: 1 });
    // Should NOT have emitted yet
    expect(mockSocket.emit).not.toHaveBeenCalled();

    // Now connect — queued events should flush
    (mockSocket as any).connected = true;
    await service.connect('valid.jwt.token');
    expect(mockSocket.emit).toHaveBeenCalledWith('PLAYER_MOVED', { x: 1, y: 0, z: 1 });
  });

  it('(e) on() handler registration → handler called when event received', () => {
    const handler = vi.fn();
    service.on('ROOM_JOINED', handler);

    // Simulate the server emitting ROOM_JOINED
    const registeredHandler = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls
      .find(([event]) => event === 'ROOM_JOINED')?.[1];

    registeredHandler?.({ roomId: 'park', users: [] });
    expect(handler).toHaveBeenCalledWith({ roomId: 'park', users: [] });
  });

  it('(f) off() → handler deregistered, no longer called', () => {
    const handler = vi.fn();
    service.on('CHAT_MESSAGE', handler);
    service.off('CHAT_MESSAGE', handler);
    expect(mockSocket.off).toHaveBeenCalledWith('CHAT_MESSAGE', handler);
  });

  it('(g) Connection timeout (5s no WELCOME) → connection failed error', async () => {
    vi.useFakeTimers();
    // Simulate server failing to respond with WELCOME
    (mockSocket.connect as any).mockImplementation(() => {
      (mockSocket as any).connected = false;
    });

    const assertion = expect(service.connect('valid.jwt.token')).rejects.toThrow('Connection timeout');
    // Advance 5 seconds without a WELCOME event arriving
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    vi.useRealTimers();
  });
});
