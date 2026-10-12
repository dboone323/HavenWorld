import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryService } from '../telemetryService';

describe('Batch 9: Client TelemetryService & Error Scrubbing', () => {
  let telemetry: TelemetryService;

  beforeEach(() => {
    telemetry = new TelemetryService();
    telemetry.clearBreadcrumbs();
  });

  it('records breadcrumbs and respects ring-buffer capacity limit', () => {
    for (let i = 0; i < 60; i++) {
      telemetry.recordBreadcrumb('navigation', `Transition ${i}`);
    }

    const breadcrumbs = telemetry.getRecentBreadcrumbs();
    expect(breadcrumbs.length).toBe(50);
    expect(breadcrumbs[breadcrumbs.length - 1].message).toBe('Transition 59');
  });

  it('scrubs sensitive credentials from breadcrumb data', () => {
    const dirty = {
      roomId: 'room-park',
      authToken: 'eyJhbGciOiJIUzI1Ni...',
      userPassword: 'SecretPassword123!',
      nested: {
        apiSecret: 'topsecret',
        visible: 'ok',
      },
    };

    const cleaned = telemetry.sanitize(dirty);
    expect(cleaned.roomId).toBe('room-park');
    expect(cleaned.authToken).toBe('[REDACTED]');
    expect(cleaned.userPassword).toBe('[REDACTED]');
    expect((cleaned.nested as any).apiSecret).toBe('[REDACTED]');
    expect((cleaned.nested as any).visible).toBe('ok');
  });

  it('captures errors gracefully and returns handled status', () => {
    telemetry.setUserId('user-test-123');
    const result = telemetry.captureError(new TypeError('Cannot read property of undefined'), {
      action: 'item_drop',
      accessToken: 'leak_token',
    });

    expect(result.handled).toBe(true);
    expect(result.errorName).toBe('TypeError');
    expect(telemetry.getUserId()).toBe('user-test-123');
  });
});
