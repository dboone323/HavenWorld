export interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private breadcrumbs: Breadcrumb[] = [];
  private maxBreadcrumbs = 50;
  private userId: string | null = null;

  static getInstance(): TelemetryService {
    if (!this.instance) {
      this.instance = new TelemetryService();
    }
    return this.instance;
  }

  setUserId(id: string | null): void {
    this.userId = id;
  }

  getUserId(): string | null {
    return this.userId;
  }

  recordBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
    const sanitizedData = data ? this.sanitize(data) : undefined;
    const entry: Breadcrumb = {
      timestamp: new Date().toISOString(),
      category,
      message,
      data: sanitizedData,
    };

    this.breadcrumbs.push(entry);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  getRecentBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbs];
  }

  clearBreadcrumbs(): void {
    this.breadcrumbs = [];
  }

  /**
   * Sanitizes sensitive fields like tokens, passwords, and authorization headers.
   */
  public sanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('token') ||
        lower.includes('password') ||
        lower.includes('secret') ||
        lower.includes('auth')
      ) {
        clean[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        clean[key] = this.sanitize(value as Record<string, unknown>);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }

  captureError(err: Error | unknown, context?: Record<string, unknown>): { handled: boolean; errorName: string } {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    const payload = {
      name: errorObj.name,
      message: errorObj.message,
      userId: this.userId,
      context: context ? this.sanitize(context) : {},
      recentBreadcrumbs: this.getRecentBreadcrumbs().slice(-5),
    };

    if (typeof window !== 'undefined' && window.__HAVEN_DEV__) {
      console.error('[Telemetry] Captured Error:', payload);
    }

    return {
      handled: true,
      errorName: errorObj.name,
    };
  }
}

export const telemetryService = TelemetryService.getInstance();
