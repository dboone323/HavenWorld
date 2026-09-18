/**
 * HavenWorld — Avatar Physical Emote Animation Math Engine (Client ESM)
 * Pure functional calculations for character jump arcs, waving angles, and dance sways.
 */

/**
 * Computes a smooth parabolic vertical jump offset (in screen pixels, negative is upward).
 * @param {number} progress Normalized animation progress [0, 1]
 * @param {number} maxHeight Maximum upward peak jump height in pixels (default: 20)
 * @returns {number} Y offset in pixels (0 at start/end, -maxHeight at midpoint)
 */
export function computeJumpOffset(progress, maxHeight = 20) {
  const p = Math.max(0, Math.min(1, progress));
  const val = -4 * maxHeight * p * (1 - p);
  return val === 0 ? 0 : val;
}

/**
 * Computes the arm waving angle in radians.
 * @param {number} progress Normalized animation progress [0, 1]
 * @param {number} maxAngle Maximum rotation amplitude in radians (default: 0.45 rad)
 * @param {number} cycles Number of wave oscillations (default: 3)
 * @returns {number} Angle in radians
 */
export function computeWaveAngle(progress, maxAngle = 0.45, cycles = 3) {
  const p = Math.max(0, Math.min(1, progress));
  const val = Math.sin(p * Math.PI * 2 * cycles) * maxAngle;
  return val === 0 ? 0 : val;
}

/**
 * Computes dance sway offsets (horizontal sway and rhythmic step bounce).
 * @param {number} progress Normalized animation progress [0, 1]
 * @param {number} maxSway Maximum horizontal sway amplitude in pixels (default: 5)
 * @param {number} cycles Number of full sway cycles (default: 2)
 * @returns {{ x: number, y: number }}
 */
export function computeDanceOffset(progress, maxSway = 5, cycles = 2) {
  const p = Math.max(0, Math.min(1, progress));
  const rawX = Math.sin(p * Math.PI * 2 * cycles) * maxSway;
  const x = rawX === 0 ? 0 : rawX;
  const rawY = -Math.abs(Math.sin(p * Math.PI * 2 * cycles * 2)) * 3;
  const y = rawY === 0 ? 0 : rawY;
  return { x, y };
}

/**
 * Computes shadow scale factor based on vertical jump elevation.
 * @param {number} jumpOffsetY Vertical jump offset in pixels (negative value)
 * @param {number} maxHeight Maximum peak jump height in pixels
 * @param {number} minScale Minimum shadow scale at peak height (default: 0.55)
 * @returns {number}
 */
export function computeShadowScale(jumpOffsetY, maxHeight = 20, minScale = 0.55) {
  if (maxHeight <= 0) return 1.0;
  const heightRatio = Math.min(1, Math.max(0, Math.abs(jumpOffsetY) / maxHeight));
  return 1.0 - heightRatio * (1.0 - minScale);
}
