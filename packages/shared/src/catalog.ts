export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: 'FURNITURE' | 'CLOTHING' | 'PET' | 'ACC' | 'COSMETIC';
  priceCoin: number;
  priceGem: number;
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';
  assetUrl?: string;
  featuredPool?: boolean;
}

export const CATALOG_ITEMS: CatalogItem[] = [
  // Permanent Catalog
  {
    id: 'furniture-chair',
    name: 'Wooden Chair',
    description: 'A simple wooden chair. Comfortable enough.',
    category: 'FURNITURE',
    priceCoin: 25,
    priceGem: 0,
    rarity: 'COMMON',
    assetUrl: '/assets/furniture/chair.glb',
  },
  {
    id: 'furniture-table',
    name: 'Round Table',
    description: 'A round wooden table. Fits four chairs.',
    category: 'FURNITURE',
    priceCoin: 50,
    priceGem: 0,
    rarity: 'COMMON',
    assetUrl: '/assets/furniture/table.glb',
  },
  {
    id: 'furniture-sofa',
    name: 'Blue Sofa',
    description: 'A comfortable two-seater sofa in ocean blue.',
    category: 'FURNITURE',
    priceCoin: 120,
    priceGem: 0,
    rarity: 'UNCOMMON',
    assetUrl: '/assets/furniture/sofa.glb',
  },
  {
    id: 'furniture-lamp',
    name: 'Floor Lamp',
    description: 'A tall floor lamp with a warm white shade.',
    category: 'FURNITURE',
    priceCoin: 45,
    priceGem: 0,
    rarity: 'COMMON',
    assetUrl: '/assets/furniture/lamp.glb',
  },
  {
    id: 'furniture-rug',
    name: 'Red Rug',
    description: 'A classic red area rug. Ties the room together.',
    category: 'FURNITURE',
    priceCoin: 60,
    priceGem: 0,
    rarity: 'COMMON',
    assetUrl: '/assets/furniture/rug.glb',
  },
  {
    id: 'furniture-bookshelf',
    name: 'Bookshelf',
    description: 'A wooden bookshelf. Perfect for the intellectual look.',
    category: 'FURNITURE',
    priceCoin: 90,
    priceGem: 0,
    rarity: 'UNCOMMON',
    assetUrl: '/assets/furniture/bookshelf.glb',
  },
  // Rotating Featured Pool (48-hour epoch)
  {
    id: 'furniture-fireplace',
    name: 'Cozy Fireplace',
    description: 'A crackling stone fireplace that warms the entire room.',
    category: 'FURNITURE',
    priceCoin: 350,
    priceGem: 2,
    rarity: 'RARE',
    assetUrl: '/assets/furniture/fireplace.glb',
    featuredPool: true,
  },
  {
    id: 'furniture-tv',
    name: 'Modern TV Console',
    description: 'Sleek widescreen entertainment unit.',
    category: 'FURNITURE',
    priceCoin: 280,
    priceGem: 1,
    rarity: 'UNCOMMON',
    assetUrl: '/assets/furniture/tv.glb',
    featuredPool: true,
  },
  {
    id: 'furniture-plant',
    name: 'Terracotta Monstera',
    description: 'A thriving potted houseplant with lush green split leaves.',
    category: 'FURNITURE',
    priceCoin: 75,
    priceGem: 0,
    rarity: 'COMMON',
    assetUrl: '/assets/furniture/plant.glb',
    featuredPool: true,
  },
  {
    id: 'furniture-painting',
    name: 'Abstract Sunset Canvas',
    description: 'Vibrant geometric art piece framed in brushed bronze.',
    category: 'FURNITURE',
    priceCoin: 150,
    priceGem: 1,
    rarity: 'UNCOMMON',
    assetUrl: '/assets/furniture/painting.glb',
    featuredPool: true,
  },
  {
    id: 'cosmetic-neon-wings',
    name: 'Cyber Neon Wings',
    description: 'Glowing cybernetic back accessory with pulsed lighting.',
    category: 'COSMETIC',
    priceCoin: 0,
    priceGem: 15,
    rarity: 'LEGENDARY',
    featuredPool: true,
  },
  {
    id: 'cosmetic-golden-crown',
    name: 'Gilded Crown',
    description: 'Solid gold regalia awarded only to the most distinguished.',
    category: 'COSMETIC',
    priceCoin: 0,
    priceGem: 25,
    rarity: 'LEGENDARY',
    featuredPool: true,
  },
];

export const EPOCH_DURATION_MS = 172_800_000; // 48 hours

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns the current 48-hour epoch number
 */
export function getCurrentEpoch(timeMs = Date.now()): number {
  return Math.floor(timeMs / EPOCH_DURATION_MS);
}

/**
 * Returns the remaining milliseconds in the current 48-hour epoch
 */
export function getEpochRemainingMs(timeMs = Date.now()): number {
  const currentEpoch = getCurrentEpoch(timeMs);
  return (currentEpoch + 1) * EPOCH_DURATION_MS - timeMs;
}

/**
 * Returns exactly 3 featured items for the current epoch using a deterministic Fisher-Yates shuffle
 */
export function getFeaturedItems(timeMs = Date.now()): CatalogItem[] {
  const epoch = getCurrentEpoch(timeMs);
  const pool = CATALOG_ITEMS.filter((item) => item.featuredPool);
  const prng = mulberry32(epoch);

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, 3);
}
