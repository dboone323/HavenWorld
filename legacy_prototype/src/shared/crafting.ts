/**
 * HavenWorld — Workshop Crafting & Furniture Recycling System
 *
 * Players dismantle unwanted furniture items into scrap metal and timber,
 * which serve as economic resources to craft exclusive workshop recipes.
 */

import { CATALOG_ITEMS, type ItemRarity } from './catalog.ts';

export type MaterialType = 'scrap_metal' | 'timber';

export interface CraftingRecipe {
  id: string;
  name: string;
  icon: string;
  rarity: ItemRarity;
  materials: {
    scrap_metal: number;
    timber: number;
  };
  description: string;
}

export const WORKSHOP_RECIPES: Record<string, CraftingRecipe> = {
  'steampunk_sofa': {
    id: 'steampunk_sofa',
    name: 'Steampunk Clockwork Sofa',
    icon: '🛋️⚙️',
    rarity: 'epic',
    materials: { scrap_metal: 15, timber: 20 },
    description: 'Tufted vintage leather sofa with exposed brass clockwork gears.',
  },
  'reclaimed_wood_table': {
    id: 'reclaimed_wood_table',
    name: 'Reclaimed Timber Table',
    icon: '🪵✨',
    rarity: 'rare',
    materials: { scrap_metal: 5, timber: 25 },
    description: 'Rustic table assembled from aged reclaimed timber beams.',
  },
  'neon_foundry_lamp': {
    id: 'neon_foundry_lamp',
    name: 'Neon Foundry Floor Lamp',
    icon: '💡🔥',
    rarity: 'epic',
    materials: { scrap_metal: 20, timber: 10 },
    description: 'Heavy industrial pipe lamp casting vibrant fluorescent light.',
  },
  'clockwork_pet_dragon': {
    id: 'clockwork_pet_dragon',
    name: 'Mechanical Pocket Dragon',
    icon: '🐉⚙️',
    rarity: 'legendary',
    materials: { scrap_metal: 40, timber: 30 },
    description: 'Autonomous brass companion that flutters copper wings.',
  },
};

/**
 * Calculate the material yield when recycling an item.
 * Recovers ~40% of catalog value split into scrap metal and timber.
 */
export function calculateSalvageYield(itemType: string): { scrap_metal: number; timber: number } {
  const item = CATALOG_ITEMS[itemType];
  if (item && item.salvage) {
    return { ...item.salvage };
  }
  const price = item ? item.price : 200;
  const totalMaterials = Math.max(2, Math.floor((price * 0.4) / 15));
  const scrap = Math.floor(totalMaterials / 2);
  const timber = totalMaterials - scrap;
  return { scrap_metal: scrap, timber };
}

/**
 * Check whether a player has sufficient materials to craft a recipe.
 */
export function canCraftRecipe(
  recipeId: string,
  playerMaterials: { scrap_metal?: number; timber?: number } | null | undefined
): boolean {
  const recipe = WORKSHOP_RECIPES[recipeId];
  if (!recipe) return false;
  const mats = playerMaterials || { scrap_metal: 0, timber: 0 };
  const playerMetal = mats.scrap_metal || 0;
  const playerTimber = mats.timber || 0;
  return playerMetal >= recipe.materials.scrap_metal && playerTimber >= recipe.materials.timber;
}

/**
 * Deduct recipe material costs and return updated material totals.
 */
export function deductCraftingMaterials(
  recipeId: string,
  playerMaterials: { scrap_metal?: number; timber?: number }
): { scrap_metal: number; timber: number } {
  const recipe = WORKSHOP_RECIPES[recipeId];
  if (!recipe) throw new Error(`Unknown recipe: ${recipeId}`);
  const playerMetal = playerMaterials.scrap_metal || 0;
  const playerTimber = playerMaterials.timber || 0;
  if (!canCraftRecipe(recipeId, playerMaterials)) {
    throw new Error('Insufficient crafting materials');
  }
  return {
    scrap_metal: playerMetal - recipe.materials.scrap_metal,
    timber: playerTimber - recipe.materials.timber,
  };
}
