/**
 * HavenWorld — Spatial Proximity Engine (shared, isomorphic).
 * Pure functions: usable in the Node.js authoritative server and Canvas client.
 *
 * Rules:
 *   - Spoken chat has a default audible radius of 7.0 grid tiles.
 *   - /shout or /s expands radius to 14.0 grid tiles.
 *   - Whispers (/w) and system broadcasts bypass spatial filtering.
 *   - Proximity volume falloff scales linearly or exponentially from 1.0 (at distance 0)
 *     down to 0.0 at maxRadius.
 */

export const DEFAULT_AUDIBLE_RADIUS = 7.0;
export const DEFAULT_SHOUT_RADIUS = 14.0;

export interface SpatialEntity {
  x: number;
  y: number;
}

/** Compute standard Euclidean distance in grid space. */
export function gridDistance(a: SpatialEntity, b: SpatialEntity): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Check if two entities are within an audible grid distance. */
export function isWithinAudibleDistance(
  speaker: SpatialEntity,
  listener: SpatialEntity,
  radius: number = DEFAULT_AUDIBLE_RADIUS
): boolean {
  if (!Number.isFinite(speaker.x) || !Number.isFinite(speaker.y) ||
      !Number.isFinite(listener.x) || !Number.isFinite(listener.y)) {
    return false;
  }
  return gridDistance(speaker, listener) <= radius;
}

/**
 * Compute audio volume falloff based on spatial distance.
 * Returns a normalized float clamped between 0.0 and 1.0.
 */
export function computeVolumeFalloff(
  distance: number,
  maxRadius: number = DEFAULT_AUDIBLE_RADIUS
): number {
  if (distance <= 0) return 1.0;
  if (distance >= maxRadius) return 0.0;
  // Linear attenuation with a gentle cubic ease-out
  const normalized = 1.0 - (distance / maxRadius);
  return Math.max(0, Math.min(1, normalized * normalized));
}

/**
 * Filter an array or iterable of listeners to only those within radius.
 * Always includes the speaker (self).
 */
export function filterAudibleListeners<T extends SpatialEntity>(
  speaker: SpatialEntity,
  listeners: Iterable<T>,
  radius: number = DEFAULT_AUDIBLE_RADIUS
): T[] {
  const audible: T[] = [];
  for (const listener of listeners) {
    if (isWithinAudibleDistance(speaker, listener, radius)) {
      audible.push(listener);
    }
  }
  return audible;
}
