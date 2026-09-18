// HavenWorld — Isometric coordinate conversion (browser-compatible ES module)
// Source: src/shared/iso.ts — TypeScript type annotations stripped for browser execution.

export const DEFAULT_TILE_WIDTH = 64;
export const DEFAULT_TILE_HEIGHT = 32;

export function toScreen(gx, gy, originX, originY, tileWidth = DEFAULT_TILE_WIDTH, tileHeight = DEFAULT_TILE_HEIGHT) {
  return {
    x: originX + (gx - gy) * (tileWidth / 2),
    y: originY + (gx + gy) * (tileHeight / 2),
  };
}

export function toGrid(sx, sy, originX, originY, tileWidth = DEFAULT_TILE_WIDTH, tileHeight = DEFAULT_TILE_HEIGHT) {
  const dx = sx - originX;
  const dy = sy - originY;
  const gx = (dy / (tileHeight / 2) + dx / (tileWidth / 2)) / 2;
  const gy = (dy / (tileHeight / 2) - dx / (tileWidth / 2)) / 2;
  return { x: gx, y: gy };
}

export function clampGrid(value, size) {
  return Math.max(0, Math.min(size, value));
}

export function isInGrid(x, y, size) {
  return x >= 0 && y >= 0 && x <= size && y <= size;
}
