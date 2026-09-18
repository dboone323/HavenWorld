/**
 * HavenWorld — Avatar Physical Emote Animation Math Engine
 * Pure functional calculations for character jump arcs, waving angles, and dance sways.
 * 100% testable without mocks or stubs.
 */

/**
 * Computes a smooth parabolic vertical jump offset (in screen pixels, negative is upward).
 * @param progress Normalized animation progress [0, 1]
 * @param maxHeight Maximum upward peak jump height in pixels (default: 20)
 * @returns Y offset in pixels (e.g. 0 at start/end, -maxHeight at midpoint)
 */
export function computeJumpOffset(progress: number, maxHeight: number = 20): number {
  const p = Math.max(0, Math.min(1, progress));
  // 4 * maxHeight * p * (1 - p) creates a parabolic arc with peak at p = 0.5
  const val = -4 * maxHeight * p * (1 - p);
  return val === 0 ? 0 : val;
}

/**
 * Computes the arm waving angle in radians.
 * @param progress Normalized animation progress [0, 1]
 * @param maxAngle Maximum rotation amplitude in radians (default: 0.45 rad ~ 25 deg)
 * @param cycles Number of wave oscillations across the duration (default: 3)
 */
export function computeWaveAngle(progress: number, maxAngle: number = 0.45, cycles: number = 3): number {
  const p = Math.max(0, Math.min(1, progress));
  const val = Math.sin(p * Math.PI * 2 * cycles) * maxAngle;
  return val === 0 ? 0 : val;
}

/**
 * Computes dance sway offsets (horizontal sway and rhythmic step bounce).
 * @param progress Normalized animation progress [0, 1]
 * @param maxSway Maximum horizontal sway amplitude in pixels (default: 5)
 * @param cycles Number of full sway cycles (default: 2)
 */
export function computeDanceOffset(progress: number, maxSway: number = 5, cycles: number = 2): { x: number; y: number } {
  const p = Math.max(0, Math.min(1, progress));
  const rawX = Math.sin(p * Math.PI * 2 * cycles) * maxSway;
  const x = rawX === 0 ? 0 : rawX;
  // Subtle rhythmic step bobbing (bounces twice per sway cycle)
  const rawY = -Math.abs(Math.sin(p * Math.PI * 2 * cycles * 2)) * 3;
  const y = rawY === 0 ? 0 : rawY;
  return { x, y };
}

/**
 * Computes shadow scale factor based on vertical jump elevation.
 * As the character jumps higher, their ground shadow shrinks proportionally.
 * @param jumpOffsetY Vertical jump offset in pixels (negative value)
 * @param maxHeight Maximum peak jump height in pixels
 * @param minScale Minimum shadow scale at peak height (default: 0.55)
 */
export function computeShadowScale(jumpOffsetY: number, maxHeight: number = 20, minScale: number = 0.55): number {
  if (maxHeight <= 0) return 1.0;
  const heightRatio = Math.min(1, Math.max(0, Math.abs(jumpOffsetY) / maxHeight));
  return 1.0 - heightRatio * (1.0 - minScale);
}
