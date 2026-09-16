/**
 * HavenWorld — Isometric coordinate conversion (shared, isomorphic).
 * Pure functions: usable in the browser Canvas engine and in Node unit tests.
 * Derived from the original game.js toScreen/toGrid, de-coupled from the canvas.
 *
 * Conventions:
 *   - Grid coordinates (gx, gy) are tile indices on a square grid.
 *   - Screen coordinates are pixel positions on the HTML5 Canvas.
 *   - originX/originY is the screen-space pivot of grid (0,0).
 */

export interface ScreenPos {
  x: number;
  y: number;
}

export interface GridPos {
  x: number;
  y: number;
}

export const DEFAULT_TILE_WIDTH = 64;
export const DEFAULT_TILE_HEIGHT = 32;

/** Convert a grid cell center to canvas pixel coordinates. */
export function toScreen(
  gx: number,
  gy: number,
  originX: number,
  originY: number,
  tileWidth: number = DEFAULT_TILE_WIDTH,
  tileHeight: number = DEFAULT_TILE_HEIGHT,
): ScreenPos {
  return {
    x: originX + (gx - gy) * (tileWidth / 2),
    y: originY + (gx + gy) * (tileHeight / 2),
  };
}

/**
 * Convert a canvas pixel coordinate back to a (fractional) grid cell.
 * The inverse of toScreen (within floating-point tolerance).
 */
export function toGrid(
  sx: number,
  sy: number,
  originX: number,
  originY: number,
  tileWidth: number = DEFAULT_TILE_WIDTH,
  tileHeight: number = DEFAULT_TILE_HEIGHT,
): GridPos {
  const dx = sx - originX;
  const dy = sy - originY;
  const gx = (dy / (tileHeight / 2) + dx / (tileWidth / 2)) / 2;
  const gy = (dy / (tileHeight / 2) - dx / (tileWidth / 2)) / 2;
  return { x: gx, y: gy };
}

/** Clamp a grid coordinate into [0, size]. */
export function clampGrid(value: number, size: number): number {
  return Math.max(0, Math.min(size, value));
}

/** True if a fractional grid position falls inside the playable grid [0..size]. */
export function isInGrid(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x <= size && y <= size;
}