export type SecurityEventType =
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SPEED_HACK_DETECTED'
  | 'TOKEN_REUSE_DETECTED'
  | 'SQLI_ATTEMPT'
  | 'XSS_ATTEMPT'
  | 'ECONOMY_ANOMALY'
  | 'ADMIN_ACTION'
  | 'UNAUTHORIZED_ACCESS';

export type SecuritySeverity = 'info' | 'warn' | 'error' | 'critical';

export interface SecurityLogPayload {
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  ip?: string;
  details?: Record<string, unknown> | string;
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>): void => {
    /* eslint-disable-next-line no-console */
    console.info(`[INFO] ${new Date().toISOString()} - ${message}`, meta ? JSON.stringify(meta) : '');
  },
  warn: (message: string, meta?: Record<string, unknown>): void => {
    /* eslint-disable-next-line no-console */
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, meta ? JSON.stringify(meta) : '');
  },
  error: (message: string, error?: unknown, meta?: Record<string, unknown>): void => {
    /* eslint-disable-next-line no-console */
    console.error(
      `[ERROR] ${new Date().toISOString()} - ${message}`,
      error instanceof Error ? error.stack || error.message : error ?? '',
      meta ? JSON.stringify(meta) : ''
    );
  },
  debug: (message: string, meta?: Record<string, unknown>): void => {
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      /* eslint-disable-next-line no-console */
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, meta ? JSON.stringify(meta) : '');
    }
  },
};

export function securityLog(payload: SecurityLogPayload): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    channel: 'security',
    ...payload,
  };

  const formatted = JSON.stringify(logEntry);

  /* eslint-disable no-console */
  if (payload.severity === 'critical' || payload.severity === 'error') {
    console.error(`[SECURITY] ${formatted}`);
  } else if (payload.severity === 'warn') {
    console.warn(`[SECURITY] ${formatted}`);
  } else {
    console.info(`[SECURITY] ${formatted}`);
  }
  /* eslint-enable no-console */
}

export default logger;

