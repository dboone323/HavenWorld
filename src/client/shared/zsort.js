// HavenWorld — Deterministic isometric depth sorter (browser-compatible ES module)
// Source: src/shared/zsort.ts — type annotations stripped for browser execution.

const TALL_TYPES = new Set([
  'wall', 'canopy', 'arcade', 'tree', 'bookshelf', 'tall', 'fountain', 'tv',
]);

const LOW_TYPES = new Set([
  'bench', 'sofa', 'table', 'stool', 'bed', 'plant', 'neon', 'rug',
]);

export function furnitureHeightClass(f) {
  if (f.heightClass) return f.heightClass;
  if (f.type === 'rug') return 'rug';
  if (TALL_TYPES.has(f.type)) return 'tall';
  if (LOW_TYPES.has(f.type)) return 'low';
  return 'low';
}

export function heightPriority(h) {
  switch (h) {
    case 'floor': return 0;
    case 'rug': return 10;
    case 'low': return 20;
    case 'avatar': return 30;
    case 'tall': return 40;
    default: return 20;
  }
}

export function furnitureDepthKey(f) {
  const ax = f.x + (f.w && f.w > 1 ? f.w - 1 : 0);
  const ay = f.y + (f.h && f.h > 1 ? f.h - 1 : 0);
  const base = ax + ay + ((f.elevation || 0) * 2);
  const prio = heightPriority(furnitureHeightClass(f));
  const frac = ((ax % 1) + (ay % 1)) * 0.05;
  return base * 100 + prio + frac;
}

export function avatarDepthKey(p) {
  const base = p.x + p.y;
  const frac = (((p.x % 1) + 1) % 1 + (((p.y % 1) + 1) % 1)) * 0.05;
  return base * 100 + heightPriority('avatar') + frac;
}

export function sortEntities(furniture, self, others) {
  const entities = [];
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
