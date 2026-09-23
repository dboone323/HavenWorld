import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@shared/events';
import type { SocketEventType } from '@shared/events';
import { authService } from './auth';
import { SERVER_URL } from '../config';

// ─── Singleton guard ─────────────────────────────────────────────────────────

let _socket: Socket | null = null;

/**
 * Registered listeners, kept as the source of truth so subscriptions made
 * before connect() (e.g. ChatOverlay, which RoomScene constructs long before
 * it connects) survive socket teardown and recreation.
 */
const _handlers = new Map<SocketEventType, Set<(data: unknown) => void>>();

/**
 * Events emitted while the handshake is in flight, flushed in order on
 * `connect`. Without this queue, AUTH_JOIN — emitted on the line right after
 * connect() — was dropped, the server never registered the socket in the
 * room, and chat/broadcasts were silently no-ops.
 */
const _pendingEmits: Array<{ event: SocketEventType; args: unknown[] }> = [];
const MAX_PENDING_EMITS = 50;

function attachRegisteredHandlers(socket: Socket): void {
  for (const [event, handlers] of _handlers) {
    for (const handler of handlers) {
      socket.on(event, handler);
    }
  }
}

function flushPendingEmits(): void {
  if (!_socket?.connected) return;
  while (_pendingEmits.length > 0) {
    const next = _pendingEmits.shift();
    if (!next) break;
    _socket.emit(next.event, ...next.args);
  }
}

function removeHandler(event: SocketEventType, raw: (data: unknown) => void): void {
  _handlers.get(event)?.delete(raw);
  _socket?.off(event, raw);
}

// ─── Socket Service ──────────────────────────────────────────────────────────

export const socketService = {
  get socket(): Socket | null { return _socket; },
  get connected(): boolean    { return _socket?.connected ?? false; },

  /**
   * Create (or return existing) Socket.io connection.
   * Attaches access token as auth handshake.
   */
  connect(): Socket {
    if (_socket?.connected) return _socket;

    // Disconnect any stale socket before creating a new one
    if (_socket) {
      _socket.removeAllListeners();
      _socket.disconnect();
    }

    _socket = io(SERVER_URL || window.location.origin, {
      path:          '/socket.io',
      transports:    ['websocket', 'polling'],
      reconnection:  true,
      reconnectionAttempts: 10,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 15_000,
      auth: {
        token: authService.token ?? '',
      },
    });

    _socket.on('connect', () => {
      console.info('[Socket] Connected:', _socket?.id);
      // Flush events queued during the handshake (AUTH_JOIN first).
      flushPendingEmits();
    });

    _socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
    });

    _socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    // Re-attach listeners registered while no socket existed.
    attachRegisteredHandlers(_socket);

    return _socket;
  },

  disconnect(): void {
    // Never carry queued events across a logout/session boundary.
    _pendingEmits.length = 0;
    if (_socket) {
      _socket.removeAllListeners();
      _socket.disconnect();
      _socket = null;
    }
  },

  /** Typed emit helper — queues while the handshake is in flight. */
  emit(event: SocketEventType, ...args: unknown[]): void {
    if (_socket?.connected) {
      _socket.emit(event, ...args);
      return;
    }
    if (_pendingEmits.length >= MAX_PENDING_EMITS) {
      console.warn(`[Socket] emit('${event}') dropped — queue full while disconnected`);
      return;
    }
    console.warn(`[Socket] socket not connected yet — queueing emit('${event}')`);
    _pendingEmits.push({ event, args });
  },

  /** Typed listener helper — returns unsubscribe fn */
  on<T = unknown>(event: SocketEventType, handler: (data: T) => void): () => void {
    const raw = handler as (data: unknown) => void;
    let handlers = _handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      _handlers.set(event, handlers);
    }
    handlers.add(raw);
    _socket?.on(event, raw);
    return () => removeHandler(event, raw);
  },

  off(event: SocketEventType, handler?: (...args: unknown[]) => void): void {
    if (handler) {
      removeHandler(event, handler as (data: unknown) => void);
      return;
    }
    _handlers.get(event)?.clear();
    _socket?.off(event);
  },

  /** Re-attach token after a refresh (call from authService refresh callback) */
  updateAuth(): void {
    if (_socket) {
      (_socket.auth as Record<string, string>).token = authService.token ?? '';
    }
  },
};

// Wire auth logout to socket disconnect
window.addEventListener('auth:logout', () => socketService.disconnect());

// Re-export event constants for convenience
export { SOCKET_EVENTS };
