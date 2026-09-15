/**
 * HavenWorld — Isometric coordinate conversion (shared, isomorphic).
 * Pure functions: usable in the browser Canvas engine and in Node unit tests.
 * Derived from the original game.js toScreen/toGrid, de-coupled from the canvas.
 *
 * Conventions:
 *   - Grid coordinates (gx, gy) are tile indices on a square grid.
 *   - Screen coordinates are pixel positions on the HTML5 Canvas.
 *   - `originX`/`originY` is the screen-space pivot of grid (0,0).
 */

const DEFAULT_TILE_WIDTH = 64;
const DEFAULT_TILE_HEIGHT = 32;

/** Convert a grid cell center to canvas pixel coordinates. */
function toScreen(gx, gy, originX, originY, TILE_WIDTH = DEFAULT_TILE_WIDTH, TILE_HEIGHT = DEFAULT_TILE_HEIGHT) {
  return {
    x: originX + (gx - gy) * (TILE_WIDTH / 2),
    y: originY + (gx + gy) * (TILE_HEIGHT / 2)
  };
}

/**
 * Convert a canvas pixel coordinate back to a (fractional) grid cell.
 * The inverse of toScreen (within floating-point tolerance).
 */
function toGrid(sx, sy, originX, originY, TILE_WIDTH = DEFAULT_TILE_WIDTH, TILE_HEIGHT = DEFAULT_TILE_HEIGHT) {
  const dx = sx - originX;
  const dy = sy - originY;
  const gx = (dy / (TILE_HEIGHT / 2) + dx / (TILE_WIDTH / 2)) / 2;
  const gy = (dy / (TILE_HEIGHT / 2) - dx / (TILE_WIDTH / 2)) / 2;
  return { x: gx, y: gy };
}

/** Clamp a grid coordinate into [0, size]. */
function clampGrid(value, size) {
  return Math.max(0, Math.min(size, value));
}

/** True if a fractional grid position falls inside the playable grid [0..size]. */
function isInGrid(x, y, size) {
  return x >= 0 && y >= 0 && x <= size && y <= size;
}

export { toScreen, toGrid, clampGrid, isInGrid, DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT };
