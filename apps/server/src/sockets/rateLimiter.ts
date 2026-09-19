import { Socket } from 'socket.io';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { captureSecurityEvent } from '../monitoring/sentry';

interface RateRule {
  max: number;
  windowMs: number;
}

const EVENT_LIMITS: Record<string, RateRule> = {
  [SOCKET_EVENTS.CHAT_SEND]: { max: 10, windowMs: 5000 },
  [SOCKET_EVENTS.PLAYER_MOVE]: { max: 100, windowMs: 5000 },
  START_FISHING: { max: 1, windowMs: 5000 },
  RING_DOORBELL: { max: 3, windowMs: 60000 },
  TRADE_INITIATE: { max: 3, windowMs: 30000 },
};

const DEFAULT_LIMIT: RateRule = { max: 50, windowMs: 5000 };

interface EventRecord {
  timestamps: number[];
}

export class SocketRateLimiter {
  private static socketEventHistory = new Map<string, Map<string, EventRecord>>();
  private static socketViolations = new Map<string, number>();

  public static checkLimit(socket: Socket, eventName: string): boolean {
    const socketId = socket.id;
    const now = Date.now();
    const rule = EVENT_LIMITS[eventName] ?? DEFAULT_LIMIT;

    let eventMap = this.socketEventHistory.get(socketId);
    if (!eventMap) {
      eventMap = new Map();
      this.socketEventHistory.set(socketId, eventMap);
    }

    let record = eventMap.get(eventName);
    if (!record) {
      record = { timestamps: [] };
      eventMap.set(eventName, record);
    }

    // Filter out timestamps outside window
    const cutoff = now - rule.windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);

    if (record.timestamps.length >= rule.max) {
      // Limit exceeded - record violation
      const violations = (this.socketViolations.get(socketId) ?? 0) + 1;
      this.socketViolations.set(socketId, violations);

      captureSecurityEvent('RATE_LIMIT_EXCEEDED', {
        userId: socket.data?.user?.userId,
        ip: socket.handshake.address,
        eventName,
        violations,
      });

      if (violations >= 3) {
        socket.emit(SOCKET_EVENTS.ERROR, {
          code: 'RATE_LIMIT_DISCONNECT',
          message: 'Disconnected due to repeated rate limit violations.',
        });
        socket.disconnect(true);
      } else {
        socket.emit(SOCKET_EVENTS.ERROR, {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many ${eventName} events. Please slow down.`,
        });
      }

      return false; // rejected
    }

    record.timestamps.push(now);
    return true; // allowed
  }

  public static cleanup(socketId: string): void {
    this.socketEventHistory.delete(socketId);
    this.socketViolations.delete(socketId);
  }
}
