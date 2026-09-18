/**
 * HavenWorld — Deterministic isometric depth sorter (shared, isomorphic).
 * Pure functions: usable in the browser Canvas engine and in Node unit tests.
 *
 * Depth key: (x + y) composite + priority category + sub-tile bias.
 * Priority: floor(0) < rugs(10) < low furniture/seating(20) < avatars(30)
 *           < tall walls/canopies/arcade/trees(40).
 * Multi-tile furniture anchors on its far corner: (x+w + y+h).
 */

export type HeightClass = 'floor' | 'rug' | 'low' | 'avatar' | 'tall';

export interface SortableFurniture {
  type: string;
  x: number;
  y: number;
  elevation?: number;
  w?: number;
  h?: number;
  heightClass?: HeightClass;
}

export interface SortableAvatar {
  x: number;
  y: number;
}

const TALL_TYPES = new Set([
  'wall', 'canopy', 'arcade', 'tree', 'bookshelf', 'tall', 'fountain', 'tv',
]);

const LOW_TYPES = new Set([
  'bench', 'sofa', 'table', 'stool', 'bed', 'plant', 'neon', 'rug',
]);

/** Classify a furniture type into a height bucket (explicit override wins). */
export function furnitureHeightClass(f: SortableFurniture): HeightClass {
  if (f.heightClass) return f.heightClass;
  if (f.type === 'rug') return 'rug';
  if (TALL_TYPES.has(f.type)) return 'tall';
  if (LOW_TYPES.has(f.type)) return 'low';
  return 'low';
}

export function heightPriority(h: HeightClass): number {
  switch (h) {
    case 'floor': return 0;
    case 'rug': return 10;
    case 'low': return 20;
    case 'avatar': return 30;
    case 'tall': return 40;
  }
}

/** Depth key for a furniture anchor tile (far corner for multi-tile). */
export function furnitureDepthKey(f: SortableFurniture): number {
  const ax = f.x + (f.w && f.w > 1 ? f.w - 1 : 0);
  const ay = f.y + (f.h && f.h > 1 ? f.h - 1 : 0);
  const base = ax + ay + ((f.elevation || 0) * 2);
  const prio = heightPriority(furnitureHeightClass(f));
  const frac = ((ax % 1) + (ay % 1)) * 0.05;
  return base * 100 + prio + frac;
}

/** Depth key for an avatar position. */
export function avatarDepthKey(p: SortableAvatar): number {
  const base = p.x + p.y;
  const frac = (((p.x % 1) + 1) % 1 + (((p.y % 1) + 1) % 1)) * 0.05;
  return base * 100 + heightPriority('avatar') + frac;
}

export type DepthEntity =
  | { kind: 'furniture'; key: number; item: SortableFurniture }
  | { kind: 'avatar'; key: number; player: SortableAvatar; isSelf: boolean };

/** Build a depth-sorted entity list: furniture + self + others. */
export function sortEntities(
  furniture: SortableFurniture[],
  self: SortableAvatar,
  others: SortableAvatar[],
): DepthEntity[] {
  const entities: DepthEntity[] = [];
  for (const item of furniture) {
    entities.push({ kind: 'furniture', key: furnitureDepthKey(item), item });
  }
  entities.push({ kind: 'avatar', key: avatarDepthKey(self), player: self, isSelf: true });
  for (const p of others) {
    entities.push({ kind: 'avatar', key: avatarDepthKey(p), player: p, isSelf: false });
  }
  entities.sort((a, b) => a.key - b.key);
  return entities;
}
