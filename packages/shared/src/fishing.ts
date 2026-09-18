export type FishRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';

export interface FishSpecies {
  id: string;
  name: string;
  rarity: FishRarity;
  baseCoinReward: number;
  minWeight: number;
  maxWeight: number;
  rageRuns: number;
  tensionDrainRate: number; // % per sec when outside sweet spot
  tensionGainRate: number;  // % per sec when inside sweet spot
  isSeasonal?: boolean;
  season?: string;
  badgeStamp?: string;
}

export const FISH_CATALOG: FishSpecies[] = [
  {
    id: 'pond_guppy',
    name: 'Pond Guppy',
    rarity: 'COMMON',
    baseCoinReward: 5,
    minWeight: 0.5,
    maxWeight: 1.5,
    rageRuns: 0,
    tensionDrainRate: 0.20,
    tensionGainRate: 0.35,
  },
  {
    id: 'cozy_neon_tetra',
    name: 'Cozy Neon Tetra',
    rarity: 'UNCOMMON',
    baseCoinReward: 12,
    minWeight: 1.0,
    maxWeight: 3.0,
    rageRuns: 1,
    tensionDrainRate: 0.25,
    tensionGainRate: 0.35,
  },
  {
    id: 'shimmering_golden_perch',
    name: 'Shimmering Golden Perch',
    rarity: 'RARE',
    baseCoinReward: 35,
    minWeight: 3.0,
    maxWeight: 6.0,
    rageRuns: 2,
    tensionDrainRate: 0.30,
    tensionGainRate: 0.35,
  },
  {
    id: 'radiant_haven_koi',
    name: 'Radiant Haven Koi',
    rarity: 'LEGENDARY',
    baseCoinReward: 150,
    minWeight: 5.0,
    maxWeight: 8.0,
    rageRuns: 3,
    tensionDrainRate: 0.35,
    tensionGainRate: 0.35,
    badgeStamp: 'Master Angler',
  },
  {
    id: 'ice_perch',
    name: 'Ice Perch',
    rarity: 'UNCOMMON',
    baseCoinReward: 18,
    minWeight: 1.5,
    maxWeight: 4.0,
    rageRuns: 1,
    tensionDrainRate: 0.22,
    tensionGainRate: 0.35,
    isSeasonal: true,
    season: 'WINTER',
  },
  {
    id: 'sunfish',
    name: 'Sunfish',
    rarity: 'UNCOMMON',
    baseCoinReward: 18,
    minWeight: 1.5,
    maxWeight: 4.0,
    rageRuns: 1,
    tensionDrainRate: 0.22,
    tensionGainRate: 0.35,
    isSeasonal: true,
    season: 'SUMMER',
  },
];

export const FISHING_CONSTANTS = {
  SWEET_SPOT_GAIN_PER_SEC: 0.35,
  TENSION_DRAIN_PER_SEC: 0.20,
  RAGE_TELEGRAPH_SECONDS: 0.4,
  MAX_TENSION: 1.0,
  TARGET_TENSION_WIN: 1.0,
  TICK_RATE_MS: 100, // 10 Hz server tension update
};
