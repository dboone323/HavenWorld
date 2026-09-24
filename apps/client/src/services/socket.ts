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

// ─── Connection status (surfaced to the UI) ─────────────────────────────────

export type SocketConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'reconnect_failed'
  | 'disconnected';

export interface SocketStatusDetail {
  status: SocketConnectionStatus;
  /** Current reconnect attempt (0 when not reconnecting). */
  attempt: number;
}

const MAX_RECONNECT_ATTEMPTS = 10;

let _status: SocketStatusDetail = { status: 'disconnected', attempt: 0 };

/** Broadcast the current connection state so the UI can react (banner, etc.). */
function emitStatus(status: SocketConnectionStatus, attempt = 0): void {
  _status = { status, attempt };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SocketStatusDetail>('socket:status', { detail: _status }));
  }
}

// ─── Socket Service ──────────────────────────────────────────────────────────

export const socketService = {
  get socket(): Socket | null { return _socket; },
  get connected(): boolean    { return _socket?.connected ?? false; },
  /** Last broadcast connection status (for UI that mounts after events). */
  get status(): SocketStatusDetail { return { ..._status }; },

  /**
   * Create (or return existing) Socket.io connection.
   * Attaches the access token to every handshake via the function form of
   * `auth`, so a refreshed token is always sent — including on reconnects.
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
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 15_000,
      // Function form: evaluated on EVERY handshake (initial + each
      // reconnect), so a refreshed access token is always the one sent.
      // See updateAuth() and the 'auth:token-refreshed' listener below.
      auth: (cb: (data: object) => void) => {
        cb({ token: authService.token ?? '' });
      },
    });

    emitStatus('connecting');

    _socket.on('connect', () => {
      console.info('[Socket] Connected:', _socket?.id);
      emitStatus('connected');
      // Flush events queued during the handshake (AUTH_JOIN first).
      flushPendingEmits();
    });

    _socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
      // The manager retries automatically (reconnect_attempt below drives the
      // banner). Only mark plain 'disconnected' when no retry is in flight.
      if (_status.status !== 'reconnecting' && _status.status !== 'reconnect_failed') {
        emitStatus('disconnected');
      }
    });

    _socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      if (_status.status !== 'reconnecting' && _status.status !== 'reconnect_failed') {
        emitStatus('connecting');
      }
    });

    // Manager-level reconnect lifecycle. `_socket.io` is the socket.io
    // Manager; guarded with ?. so the unit-test mock (no Manager) keeps
    // working and these lines are simply skipped there.
    _socket.io?.on('reconnect_attempt', (attempt: number) => {
      console.warn(`[Socket] Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);
      emitStatus('reconnecting', attempt);
      // Best-effort: refresh the access token in the background so the next
      // handshake carries a live token. refresh() is single-flight, and the
      // function-form `auth` above picks the new token up automatically.
      void authService.refresh().then((ok) => {
        if (ok) socketService.updateAuth();
      });
    });

    _socket.io?.on('reconnect', () => {
      console.info('[Socket] Reconnected');
      emitStatus('connected');
    });

    _socket.io?.on('reconnect_failed', () => {
      console.error('[Socket] Reconnect attempts exhausted');
      emitStatus('reconnect_failed', MAX_RECONNECT_ATTEMPTS);
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
    emitStatus('disconnected');
  },

  /**
   * Manual reconnect (e.g. from the connection banner after attempts are
   * exhausted). Re-enables the manager's retry loop and kicks a fresh
   * handshake immediately.
   */
  reconnectNow(): void {
    if (!_socket) {
      this.connect();
      return;
    }
    console.info('[Socket] Manual reconnect requested');
    _socket.io?.reconnection(true);
    _socket.connect();
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

  /**
   * Re-attach the current access token. With the function-form `auth` above,
   * every handshake already reads the latest token, so this is belt-and-braces
   * for any path that still inspects `socket.auth` directly.
   */
  updateAuth(): void {
    if (_socket) {
      _socket.auth = (cb: (data: object) => void) => {
        cb({ token: authService.token ?? '' });
      };
    }
  },
};

// Wire auth logout to socket disconnect
window.addEventListener('auth:logout', () => socketService.disconnect());

// Keep the socket's handshake token in sync when authService rotates it
// (dispatched from auth.ts after a successful token refresh).
window.addEventListener('auth:token-refreshed', () => socketService.updateAuth());

// Re-export event constants for convenience
export { SOCKET_EVENTS };
