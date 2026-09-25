export interface Position3D {
  x: number;
  y: number;
  z?: number;
}

export interface MovementValidationResult {
  valid: boolean;
  correctedPosition: Position3D;
  violations: number;
  reason?: string;
}

interface PlayerMovementState {
  x: number;
  y: number;
  z: number;
  timestamp: number;
  violations: number;
}

export class MovementValidator {
  private static playerStates = new Map<string, PlayerMovementState>();

  // Speed configuration:
  // Base player speed: 8 units/sec
  // Latency tolerance multiplier: 2.5x (allows for network jitter and packet batching)
  private static readonly MAX_SPEED_UNITS_PER_SEC = 8.0;
  private static readonly SPEED_TOLERANCE = 2.5;
  private static readonly MAX_VIOLATIONS_BEFORE_DISCONNECT = 3;

  public static initializePlayer(playerId: string, pos: Position3D): void {
    this.playerStates.set(playerId, {
      x: pos.x,
      y: pos.y,
      z: pos.z ?? 0,
      timestamp: Date.now(),
      violations: 0,
    });
  }

  public static validateMovement(
    playerId: string,
    requested: Position3D
  ): MovementValidationResult {
    const now = Date.now();
    let state = this.playerStates.get(playerId);

    if (!state) {
      this.initializePlayer(playerId, requested);
      return {
        valid: true,
        correctedPosition: requested,
        violations: 0,
      };
    }

    const elapsedMs = Math.max(16, Math.min(2000, now - state.timestamp)); // clamp between 16ms and 2s
    const elapsedSec = elapsedMs / 1000;

    const dx = requested.x - state.x;
    const dy = requested.y - state.y;
    const dz = (requested.z ?? 0) - state.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const baseSpeed = this.MAX_SPEED_UNITS_PER_SEC;
    const maxAllowedDistance = baseSpeed * elapsedSec * this.SPEED_TOLERANCE;
    const minThreshold = 1.5;

    if (distance > Math.max(minThreshold, maxAllowedDistance)) {
      state.violations += 1;
      // Do not update position; keep last valid position
      return {
        valid: false,
        correctedPosition: { x: state.x, y: state.y, z: state.z },
        violations: state.violations,
        reason: `SPEED_LIMIT_EXCEEDED: moved ${distance.toFixed(2)} in ${elapsedSec.toFixed(2)}s (max allowed: ${maxAllowedDistance.toFixed(2)})`,
      };
    }

    // Valid movement: update state
    state.x = requested.x;
    state.y = requested.y;
    state.z = requested.z ?? 0;
    state.timestamp = now;

    return {
      valid: true,
      correctedPosition: requested,
      violations: state.violations,
    };
  }

  public static removePlayer(playerId: string): void {
    this.playerStates.delete(playerId);
  }

  public static getViolations(playerId: string): number {
    return this.playerStates.get(playerId)?.violations ?? 0;
  }
}
