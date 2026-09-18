export type RawMaterial = 'scrap_metal' | 'timber' | 'fabric' | 'crystal_shard';

export interface CraftingRecipe {
  id: string;
  name: string;
  description: string;
  materials: Array<{ type: RawMaterial; qty: number }>;
  outputItemId: string;
  craftingMinutes: number;
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';
  seasonal?: string;
}

export const MATERIAL_VALUES: Record<RawMaterial, number> = {
  scrap_metal: 5,
  timber: 4,
  fabric: 6,
  crystal_shard: 15,
};

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  {
    id: 'recipe_reclaimed_bookshelf',
    name: 'Reclaimed Bookshelf',
    description: 'Upcycled rustic bookcase crafted from reclaimed pine and woven canvas.',
    materials: [
      { type: 'timber', qty: 10 },
      { type: 'fabric', qty: 2 },
    ],
    outputItemId: 'furniture-bookshelf',
    craftingMinutes: 15,
    rarity: 'COMMON',
  },
  {
    id: 'recipe_steampunk_sofa',
    name: 'Steampunk Sofa',
    description: 'Leather and brass two-seater with exposed decorative copper piping.',
    materials: [
      { type: 'scrap_metal', qty: 8 },
      { type: 'timber', qty: 3 },
    ],
    outputItemId: 'furniture-sofa',
    craftingMinutes: 45,
    rarity: 'RARE',
  },
  {
    id: 'recipe_clockwork_clock',
    name: 'Clockwork Wall Clock',
    description: 'Intricate brass pendulum clock powered by precision cut quartz crystals.',
    materials: [
      { type: 'scrap_metal', qty: 6 },
      { type: 'crystal_shard', qty: 2 },
    ],
    outputItemId: 'furniture-clock',
    craftingMinutes: 45,
    rarity: 'RARE',
  },
  {
    id: 'recipe_neon_lamp',
    name: 'Prismatic Neon Lamp',
    description: 'Vibrant geometric desk lamp radiating a crystalline glow.',
    materials: [
      { type: 'crystal_shard', qty: 4 },
      { type: 'scrap_metal', qty: 2 },
    ],
    outputItemId: 'furniture-lamp',
    craftingMinutes: 45,
    rarity: 'RARE',
  },
  {
    id: 'recipe_dragon_planter',
    name: 'Dragon Egg Planter',
    description: 'Mythical iridescent dragon egg carved into a ceremonial botanical vessel.',
    materials: [
      { type: 'crystal_shard', qty: 5 },
      { type: 'timber', qty: 3 },
    ],
    outputItemId: 'furniture-plant',
    craftingMinutes: 120,
    rarity: 'LEGENDARY',
  },
  {
    id: 'recipe_snowglobe_lamp',
    name: 'Snowglobe Lamp',
    description: 'Winter holiday exclusive illuminated globe featuring drifting frost.',
    materials: [
      { type: 'crystal_shard', qty: 3 },
      { type: 'timber', qty: 2 },
    ],
    outputItemId: 'furniture-snowglobe',
    craftingMinutes: 30,
    rarity: 'RARE',
    seasonal: 'WINTER',
  },
  {
    id: 'recipe_haunted_mirror',
    name: 'Haunted Mirror',
    description: 'Autumn festival antique mirror that occasionally reflects strange apparitions.',
    materials: [
      { type: 'crystal_shard', qty: 3 },
      { type: 'scrap_metal', qty: 3 },
    ],
    outputItemId: 'furniture-mirror',
    craftingMinutes: 30,
    rarity: 'RARE',
    seasonal: 'AUTUMN',
  },
];

/**
 * Calculates raw material recycling yields for an item based on its price and category
 */
export function calculateRecycleYield(
  itemPriceCoins: number,
  primaryMaterial: RawMaterial
): number {
  const materialValue = MATERIAL_VALUES[primaryMaterial] || 5;
  return Math.max(1, Math.floor((itemPriceCoins * 0.4) / materialValue));
}
