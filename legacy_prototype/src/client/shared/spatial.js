/**
 * HavenWorld — Spatial Proximity Engine (client-side ESM).
 */

export const DEFAULT_AUDIBLE_RADIUS = 7.0;
export const DEFAULT_SHOUT_RADIUS = 14.0;

export function gridDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isWithinAudibleDistance(speaker, listener, radius = DEFAULT_AUDIBLE_RADIUS) {
  if (!Number.isFinite(speaker.x) || !Number.isFinite(speaker.y) ||
      !Number.isFinite(listener.x) || !Number.isFinite(listener.y)) {
    return false;
  }
  return gridDistance(speaker, listener) <= radius;
}

export function computeVolumeFalloff(distance, maxRadius = DEFAULT_AUDIBLE_RADIUS) {
  if (distance <= 0) return 1.0;
  if (distance >= maxRadius) return 0.0;
  const normalized = 1.0 - (distance / maxRadius);
  return Math.max(0, Math.min(1, normalized * normalized));
}

export function filterAudibleListeners(speaker, listeners, radius = DEFAULT_AUDIBLE_RADIUS) {
  const audible = [];
  for (const listener of listeners) {
    if (isWithinAudibleDistance(speaker, listener, radius)) {
      audible.push(listener);
    }
  }
  return audible;
}
