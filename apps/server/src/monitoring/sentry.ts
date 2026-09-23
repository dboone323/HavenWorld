import * as Sentry from '@sentry/node';
import { securityLog, type SecurityEventType } from './logger';

const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'invitecode',
  'secret',
  'authorization',
  'cookie',
  'csrf_token',
]);

function scrubValue(key: string, value: unknown): unknown {
  if (typeof key === 'string' && SENSITIVE_KEYS.has(key.toLowerCase())) {
    return '[REDACTED]';
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'object' ? scrubObject(v) : v));
    }
    return scrubObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    scrubbed[k] = scrubValue(k, v);
  }
  return scrubbed;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // 1. Scrub request headers
      if (event.request?.headers) {
        if (event.request.headers.authorization) {
          event.request.headers.authorization = '[REDACTED]';
        }
        if (event.request.headers.cookie) {
          event.request.headers.cookie = '[REDACTED]';
        }
        if (event.request.headers['x-csrf-token']) {
          event.request.headers['x-csrf-token'] = '[REDACTED]';
        }
      }

      // 2. Scrub request body data
      if (event.request?.data && typeof event.request.data === 'object') {
        event.request.data = scrubObject(event.request.data as Record<string, unknown>);
      }

      // 3. Scrub extra / breadcrumbs
      if (event.extra) {
        event.extra = scrubObject(event.extra);
      }

      return event;
    },
  });
}

export function captureSecurityEvent(
  eventType: SecurityEventType,
  details: Record<string, unknown> & { userId?: string; ip?: string }
): void {
  securityLog({
    eventType,
    severity: 'warn',
    userId: details.userId,
    ip: details.ip,
    details,
  });

  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(`Security Event: ${eventType}`, {
      level: 'warning',
      tags: {
        securityEventType: eventType,
        ...(details.userId && { userId: details.userId }),
      },
      extra: scrubObject(details),
    });
  }
}

/** Report a caught-but-serious error (used by the process crash handlers in
 *  index.ts). No-ops when Sentry is not configured. */
export function captureException(error: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(error);
}
