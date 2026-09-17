/**
 * HavenWorld — Plaza Fountain Fishing Activity.
 * Pure game logic module, unit-testable in Node without browser dependencies.
 */

export const FISH_SPECIES = {
  pond_guppy: {
    id: 'pond_guppy',
    name: 'Pond Guppy',
    rarity: 'common',
    coins: 35,
    icon: '🐟',
    minWeight: 0.2,
    maxWeight: 0.6
  },
  cozy_tetra: {
    id: 'cozy_tetra',
    name: 'Cozy Neon Tetra',
    rarity: 'uncommon',
    coins: 75,
    icon: '🐠',
    minWeight: 0.4,
    maxWeight: 1.2
  },
  golden_perch: {
    id: 'golden_perch',
    name: 'Shimmering Golden Perch',
    rarity: 'rare',
    coins: 150,
    icon: '🐡',
    minWeight: 1.5,
    maxWeight: 3.5
  },
  haven_koi: {
    id: 'haven_koi',
    name: 'Radiant Haven Koi',
    rarity: 'legendary',
    coins: 350,
    icon: '✨🐟',
    minWeight: 3.0,
    maxWeight: 6.8
  }
};

/**
 * Determine fish catch based on a roll [0, 1).
 */
export function rollCatch(roll = Math.random()) {
  if (roll < 0.50) return FISH_SPECIES.pond_guppy;
  if (roll < 0.80) return FISH_SPECIES.cozy_tetra;
  if (roll < 0.95) return FISH_SPECIES.golden_perch;
  return FISH_SPECIES.haven_koi;
}

/**
 * Update catch progress / tension bar.
 * If inZone is true, progress increases by 25%/s.
 * If inZone is false, progress drops by 15%/s.
 */
export function updateProgress(currentProgress, inZone, dt) {
  const rate = inZone ? 35 : -20;
  const next = currentProgress + rate * dt;
  return Math.max(0, Math.min(100, next));
}

/**
 * Generates fish weight rounded to 2 decimal places.
 */
export function generateWeight(fish, roll = Math.random()) {
  const weight = fish.minWeight + roll * (fish.maxWeight - fish.minWeight);
  return Math.round(weight * 100) / 100;
}
