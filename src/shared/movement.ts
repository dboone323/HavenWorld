/**
 * HavenWorld — Movement + animation helpers (shared, isomorphic).
 */

/** Linear interpolation between a and b by t (0..1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type FacingDirection = 'NE' | 'SE' | 'SW' | 'NW';

export interface PlayerMovement {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isWalking?: boolean;
  walkCycle?: number;
  facing?: FacingDirection;
  isSitting?: boolean;
}

/** Calculate 4-way isometric facing direction from grid motion vector.
 * Optional `fallback` is returned when the vector is near-zero (instead of null)
 * so callers can preserve the previous facing without extra branching. */
export function calculateFacing(dx: number, dy: number, fallback?: FacingDirection): FacingDirection | null {
  if (Math.hypot(dx, dy) < 0.01) return fallback ?? null;
  // Isometric projection screen delta:
  const screenDx = dx - dy;
  const screenDy = dx + dy;
  if (Math.abs(screenDx) > Math.abs(screenDy)) {
    return screenDx > 0 ? 'NE' : 'SW';
  } else {
    return screenDy > 0 ? 'SE' : 'NW';
  }
}

/** Compute subtle sinusoidal walking vertical bob in pixels. */
export function getWalkBob(walkCycle: number = 0, isWalking: boolean = false): number {
  if (!isWalking) return 0;
  return Math.sin(walkCycle) * 2.5;
}

export interface StepResult {
  moved: boolean;
  snapped: boolean;
}

/** Advance a player toward targetX/targetY by up to speed*dt; mutates in place. */
export function stepToward(
  player: PlayerMovement,
  dt: number,
  speed: number = 3.8,
): StepResult {
  const dx = player.targetX - player.x;
  const dy = player.targetY - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.05) {
    const step = Math.min(dist, speed * dt);
    player.x += (dx / dist) * step;
    player.y += (dy / dist) * step;
    player.isWalking = true;
    player.isSitting = false;
    player.walkCycle = (player.walkCycle || 0) + dt * 10;
    const f = calculateFacing(dx, dy);
    if (f) player.facing = f;
    return { moved: true, snapped: false };
  }
  player.x = player.targetX;
  player.y = player.targetY;
  player.isWalking = false;
  player.walkCycle = 0;
  return { moved: false, snapped: true };
}

/** Frame delta in seconds, clamped to 0.1s for a stable simulation. */
export function frameDt(now: number, lastTime: number): number {
  return Math.min(0.1, (now - lastTime) / 1000);
}

/** Speech-bubble alpha from chat age (seconds): 1 -> fade -> -1 = expired. */
export function fadeAlpha(ageSeconds: number, lifetime: number = 6, fadeStart: number = 5): number {
  if (ageSeconds >= lifetime) return -1;
  if (ageSeconds > fadeStart) return Math.max(0, 1 - (ageSeconds - fadeStart));
  return 1;
}