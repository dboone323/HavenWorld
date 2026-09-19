import { io, Socket } from 'socket.io-client';

export class NotAuthenticatedError extends Error {
  constructor(message = 'Authentication token required') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export interface QueuedEvent {
  event: string;
  data: any;
}

export class SocketService {
  public socket: Socket | null = null;
  private queuedEvents: QueuedEvent[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private connectTimeoutTimer: any = null;

  constructor(serverUrl?: string) {
    const defaultUrl =
      typeof import.meta !== 'undefined' && import.meta.env?.VITE_SOCKET_URL
        ? import.meta.env.VITE_SOCKET_URL
        : typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:4000';

    this.socket = io(serverUrl || defaultUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: {},
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('disconnect', (reason: string) => {
      this.handleDisconnect(reason);
    });

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0;
      this.flushQueue();
    });

    this.socket.on('WELCOME', () => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }
      this.flushQueue();
    });
  }

  private handleDisconnect(_reason: string): void {
    this.reconnectAttempts++;
    // Exponential backoff: 1000ms, 2000ms, 4000ms...
    const delay = 1000 * Math.pow(2, this.reconnectAttempts - 1);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (this.socket) {
        this.socket.connect();
      }
    }, delay);
  }

  async connect(token: string): Promise<void> {
    if (!token || token.trim().length === 0) {
      throw new NotAuthenticatedError('Authentication token required');
    }

    if (!this.socket) {
      throw new Error('Socket not initialized');
    }

    (this.socket as any).auth = { token };

    return new Promise<void>((resolve, reject) => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer);
      }

      this.connectTimeoutTimer = setTimeout(() => {
        this.connectTimeoutTimer = null;
        reject(new Error('Connection timeout'));
      }, 5000);

      const onWelcome = () => {
        if (this.connectTimeoutTimer) {
          clearTimeout(this.connectTimeoutTimer);
          this.connectTimeoutTimer = null;
        }
        this.socket?.off('WELCOME', onWelcome);
        this.socket?.off('connect', onWelcome);
        this.flushQueue();
        resolve();
      };

      this.socket.on('WELCOME', onWelcome);
      this.socket.on('connect', onWelcome);

      this.socket.connect();

      if (this.socket.connected) {
        onWelcome();
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    this.socket?.disconnect();
  }

  emit(event: string, data: any): void {
    if (!this.socket || !this.socket.connected) {
      this.queuedEvents.push({ event, data });
      return;
    }
    this.socket.emit(event, data);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.socket?.on(event, handler);
  }

  off(event: string, handler?: (...args: any[]) => void): void {
    if (handler) {
      this.socket?.off(event, handler);
    } else {
      this.socket?.off(event);
    }
  }

  private flushQueue(): void {
    if (!this.socket || !this.socket.connected || this.queuedEvents.length === 0) return;
    const eventsToFlush = [...this.queuedEvents];
    this.queuedEvents = [];
    for (const { event, data } of eventsToFlush) {
      this.socket.emit(event, data);
    }
  }
}

export const socketService = new SocketService();
