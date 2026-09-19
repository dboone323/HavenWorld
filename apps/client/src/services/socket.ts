import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@shared/events';
import type { SocketEventType } from '@shared/events';
import { authService } from './auth';
import { SERVER_URL } from '../config';

// ─── Singleton guard ─────────────────────────────────────────────────────────

let _socket: Socket | null = null;

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
      console.info('[Socket] Connected:', _socket!.id);
    });

    _socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
    });

    _socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    return _socket;
  },

  disconnect(): void {
    if (_socket) {
      _socket.removeAllListeners();
      _socket.disconnect();
      _socket = null;
    }
  },

  /** Typed emit helper */
  emit(event: SocketEventType, ...args: unknown[]): void {
    if (!_socket?.connected) {
      console.warn('[Socket] emit called but socket not connected');
      return;
    }
    _socket.emit(event, ...args);
  },

  /** Typed listener helper — returns unsubscribe fn */
  on<T = unknown>(event: SocketEventType, handler: (data: T) => void): () => void {
    _socket?.on(event, handler as (data: unknown) => void);
    return () => _socket?.off(event, handler as (data: unknown) => void);
  },

  off(event: SocketEventType, handler?: (...args: unknown[]) => void): void {
    _socket?.off(event, handler);
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
