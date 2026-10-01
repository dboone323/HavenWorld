import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SOCKET_EVENTS } from '@shared/events';
import type { SocketEventType } from '@shared/events';
import { socketService } from '../socket';

describe('socketService (services/socket.ts — Real Functional Validation)', () => {
  let emitted: Array<{ event: SocketEventType; args: unknown[] }> = [];
  let unsubEmit: (() => void) | null = null;

  beforeEach(() => {
    socketService.disconnect();
    emitted = [];
    unsubEmit = socketService.onEmit((event, args) => {
      emitted.push({ event, args });
    });
  });

  afterEach(() => {
    unsubEmit?.();
    unsubEmit = null;
    socketService.disconnect();
  });

  it('(a) emits fired before the handshake completes are queued, then flushed in order on connect', () => {
    socketService.connect(); // socket created, handshake in flight
    expect(socketService.connected).toBe(false);

    socketService.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId: 'room-1' });
    socketService.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'hello' });

    expect(emitted).toHaveLength(0);

    socketService.simulateHandshakeComplete();

    expect(emitted).toEqual([
      { event: SOCKET_EVENTS.AUTH_JOIN, args: [{ roomId: 'room-1' }] },
      { event: SOCKET_EVENTS.CHAT_SEND, args: [{ content: 'hello' }] },
    ]);
  });

  it('(b) a listener registered BEFORE connect() still receives events (ChatOverlay ordering)', () => {
    const seen: string[] = [];

    const unsub = socketService.on<{ text: string }>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
      seen.push(msg.text);
    });

    socketService.connect();
    socketService.simulateHandshakeComplete();

    socketService.dispatchIncoming(SOCKET_EVENTS.CHAT_MESSAGE, { text: 'hello' });
    expect(seen).toEqual(['hello']);

    unsub();
    socketService.dispatchIncoming(SOCKET_EVENTS.CHAT_MESSAGE, { text: 'ignored' });
    expect(seen).toEqual(['hello']);
  });

  it('(c) registered listeners survive a stale-socket teardown and reconnect', () => {
    const seen: string[] = [];

    const unsub = socketService.on<{ text: string }>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
      seen.push(msg.text);
    });
    socketService.connect();
    socketService.simulateHandshakeComplete();

    socketService.disconnect();
    socketService.connect();
    socketService.simulateHandshakeComplete();

    socketService.dispatchIncoming(SOCKET_EVENTS.CHAT_MESSAGE, { text: 'after-reconnect' });
    expect(seen).toEqual(['after-reconnect']);
    unsub();
  });

  it('(d) queue is bounded — emits beyond the 50-item cap are dropped', () => {
    socketService.connect();

    for (let i = 0; i < 51; i++) {
      socketService.emit(SOCKET_EVENTS.CHAT_SEND, { i });
    }

    socketService.simulateHandshakeComplete();

    expect(emitted).toHaveLength(50);
    expect(emitted[49]).toEqual({
      event: SOCKET_EVENTS.CHAT_SEND,
      args: [{ i: 49 }],
    });
  });

  it('(e) disconnect() clears the queue so nothing leaks across a logout', () => {
    socketService.connect();

    socketService.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId: 'stale-room' });
    socketService.disconnect();

    socketService.connect();
    socketService.simulateHandshakeComplete();

    expect(emitted).toHaveLength(0);
  });

  it('(f) emits go straight through once connected (no queuing)', () => {
    socketService.connect();
    socketService.simulateHandshakeComplete();

    socketService.emit(SOCKET_EVENTS.CHAT_SEND, { content: 'hi' });

    expect(emitted).toEqual([
      { event: SOCKET_EVENTS.CHAT_SEND, args: [{ content: 'hi' }] },
    ]);
  });

  it('(g) connect() broadcasts socket:status lifecycle events (connecting -> connected)', () => {
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail.status);
    window.addEventListener('socket:status', listener);
    try {
      socketService.connect();
      socketService.simulateHandshakeComplete();
      expect(seen).toEqual(['connecting', 'connected']);
      expect(socketService.status).toEqual({ status: 'connected', attempt: 0 });
    } finally {
      window.removeEventListener('socket:status', listener);
    }
  });

  it('(h) updateAuth() installs function-form auth so handshakes read the live token', () => {
    socketService.connect();
    socketService.updateAuth();
    expect(typeof socketService.socket?.auth).toBe('function');
    let authPayload: Record<string, unknown> | null = null;
    (socketService.socket?.auth as unknown as (cb: (data: Record<string, unknown>) => void) => void)((data) => {
      authPayload = data;
    });
    expect(authPayload).toEqual({ token: expect.any(String) });
  });

  it('(i) reconnectNow() creates a socket when none exists (manual retry after exhaustion)', () => {
    expect(socketService.socket).toBeNull();
    socketService.reconnectNow();
    expect(socketService.socket).not.toBeNull();
  });
});
