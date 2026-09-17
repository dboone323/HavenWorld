// HavenWorld — Authoritative movement validation + delta codec (browser ESM mirror)
// Source: src/shared/authority.ts — type annotations stripped for browser execution.

export const AUTHORITY_TICK_MS = 50;
export const AUTHORITY_TICK_DT = AUTHORITY_TICK_MS / 1000;
export const PLAYER_SPEED = 3.8;
export const RECONCILE_EPSILON = 0.5;
export const GRID_MAX = 11;

export function clampGrid(value, size = GRID_MAX) {
  return Math.max(0, Math.min(size, value));
}

export function facingToInt(f) {
  switch (f) {
    case 'NE': return 0;
    case 'SE': return 1;
    case 'SW': return 2;
    case 'NW': return 3;
    default: return 1;
  }
}

export function intToFacing(n) {
  switch (n) {
    case 0: return 'NE';
    case 1: return 'SE';
    case 2: return 'SW';
    case 3: return 'NW';
    default: return 'SE';
  }
}

export function encodePlayerDelta(id, p) {
  const mask = (p.isSitting ? 1 : 0) | (p.isWalking ? 2 : 0);
  return [id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, facingToInt(p.facing), mask];
}

export function decodePlayerDelta(d) {
  return {
    id: d[0], x: d[1], y: d[2], facing: intToFacing(d[3]),
    isSitting: (d[4] & 1) !== 0, isWalking: (d[4] & 2) !== 0,
  };
}

/** Client-side interpolation buffer: lerp between last two authoritative samples. */
export function interpolatePosition(prev, next, alpha) {
  const t = Math.max(0, Math.min(1, alpha));
  return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
}
