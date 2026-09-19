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

export function securityLog(payload: SecurityLogPayload): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    channel: 'security',
    ...payload,
  };

  const formatted = JSON.stringify(logEntry);

  if (payload.severity === 'critical' || payload.severity === 'error') {
    console.error(`[SECURITY] ${formatted}`);
  } else if (payload.severity === 'warn') {
    console.warn(`[SECURITY] ${formatted}`);
  } else {
    console.info(`[SECURITY] ${formatted}`);
  }
}
