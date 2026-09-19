import { FishingService } from '../services/FishingService';
import { captureSecurityEvent } from '../monitoring/sentry';

interface CastTracker {
  startTime: number;
  sessionToken: string;
}

export class SecureFishingSystem {
  private static castSessions = new Map<string, CastTracker>();

  private static readonly MIN_REEL_TIME_MS = 3000; // minimum 3 seconds
  private static readonly MAX_REEL_TIME_MS = 60000; // maximum 60 seconds

  public static recordCast(userId: string, sessionToken: string): void {
    this.castSessions.set(userId, {
      startTime: Date.now(),
      sessionToken,
    });
  }

  public static validateReel(userId: string, sessionToken: string): boolean {
    const cast = this.castSessions.get(userId);
    if (!cast) {
      captureSecurityEvent('ECONOMY_ANOMALY', {
        userId,
        details: { action: 'fishing_reel_no_cast' },
      });
      return false;
    }

    if (cast.sessionToken !== sessionToken) {
      captureSecurityEvent('ECONOMY_ANOMALY', {
        userId,
        details: { action: 'fishing_session_token_mismatch' },
      });
      return false;
    }

    const elapsed = Date.now() - cast.startTime;
    this.castSessions.delete(userId);

    // Fast-click / instant bot check
    if (elapsed < this.MIN_REEL_TIME_MS) {
      captureSecurityEvent('ECONOMY_ANOMALY', {
        userId,
        details: { action: 'fishing_instant_catch_bot', elapsedMs: elapsed },
      });
      return false;
    }

    // Expired check
    if (elapsed > this.MAX_REEL_TIME_MS) {
      return false;
    }

    return true;
  }

  public static cancelCast(userId: string): void {
    this.castSessions.delete(userId);
    FishingService.cancelSession(userId);
  }
}
