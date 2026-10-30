import { prisma } from '../prisma';
import { WorkshopService } from './WorkshopService';
import { AnalyticsService } from './AnalyticsService';
import { CRAFTING_RECIPES } from '@havenworld/shared';

export interface QueueSlotStatus {
  activeCount: number;
  maxSlots: number;
  availableSlots: number;
}

/**
 * Service managing workshop crafting validation, recipe unlocks, and queue slot expansions.
 */
export class CraftingService extends WorkshopService {
  private static readonly BASE_QUEUE_SLOTS = 2;
  private static readonly MAX_QUEUE_SLOTS = 5;

  // In-memory unlock and slot tracking registries (resilient per-process)
  private static userUnlockedRecipes = new Map<string, Set<string>>();
  private static userBonusSlots = new Map<string, number>();

  /**
   * Returns maximum concurrent crafting queue slots for a user
   */
  static async getUserMaxQueueSlots(userId: string): Promise<number> {
    const bonus = this.userBonusSlots.get(userId) || 0;
    return Math.min(this.MAX_QUEUE_SLOTS, this.BASE_QUEUE_SLOTS + bonus);
  }

  /**
   * Expands queue capacity for a user up to MAX_QUEUE_SLOTS
   */
  static async expandQueueSlots(
    userId: string,
    slotsToAdd: number = 1
  ): Promise<{ previousSlots: number; currentSlots: number; maxSlots: number }> {
    const currentMax = await this.getUserMaxQueueSlots(userId);
    if (currentMax >= this.MAX_QUEUE_SLOTS) {
      throw new Error(`Cannot expand beyond maximum capacity of ${this.MAX_QUEUE_SLOTS} slots`);
    }

    const currentBonus = this.userBonusSlots.get(userId) || 0;
    const newBonus = Math.min(this.MAX_QUEUE_SLOTS - this.BASE_QUEUE_SLOTS, currentBonus + slotsToAdd);
    this.userBonusSlots.set(userId, newBonus);

    const newMax = this.BASE_QUEUE_SLOTS + newBonus;
    await AnalyticsService.trackEvent('WORKSHOP_QUEUE_EXPANDED', {
      userId,
      payload: { previousSlots: currentMax, currentSlots: newMax },
    });

    return {
      previousSlots: currentMax,
      currentSlots: newMax,
      maxSlots: this.MAX_QUEUE_SLOTS,
    };
  }

  /**
   * Resets queue slot expansions for testing or account resets
   */
  static resetQueueSlots(userId: string): void {
    this.userBonusSlots.delete(userId);
  }

  /**
   * Checks current queue occupancy against capacity
   */
  static async getQueueSlotStatus(userId: string): Promise<QueueSlotStatus> {
    const activeCount = await prisma.craftingQueue.count({
      where: { userId, claimed: false },
    });
    const maxSlots = await this.getUserMaxQueueSlots(userId);
    return {
      activeCount,
      maxSlots,
      availableSlots: Math.max(0, maxSlots - activeCount),
    };
  }

  /**
   * Checks if a recipe is unlocked for the user.
   * COMMON and UNCOMMON recipes are inherently unlocked.
   * RARE, LEGENDARY, and seasonal recipes require explicit unlocking.
   */
  static async isRecipeUnlocked(userId: string, recipeId: string): Promise<boolean> {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;

    // Default basic tiers are unlocked for everyone
    if (recipe.rarity === 'COMMON' || recipe.rarity === 'UNCOMMON') {
      return true;
    }

    const userSet = this.userUnlockedRecipes.get(userId);
    return !!userSet?.has(recipeId);
  }

  /**
   * Unlocks an advanced crafting recipe for a user
   */
  static async unlockRecipe(
    userId: string,
    recipeId: string
  ): Promise<{ success: boolean; recipeId: string; recipeName: string }> {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) {
      throw new Error(`Recipe ${recipeId} not found in catalog`);
    }

    let userSet = this.userUnlockedRecipes.get(userId);
    if (!userSet) {
      userSet = new Set<string>();
      this.userUnlockedRecipes.set(userId, userSet);
    }
    userSet.add(recipeId);

    await AnalyticsService.trackEvent('RECIPE_UNLOCKED', {
      userId,
      payload: { recipeId, recipeName: recipe.name, rarity: recipe.rarity },
    });

    return {
      success: true,
      recipeId,
      recipeName: recipe.name,
    };
  }

  /**
   * Resets recipe unlocks for testing or reset flows
   */
  static resetRecipeUnlocks(userId: string): void {
    this.userUnlockedRecipes.delete(userId);
  }

  /**
   * Validates recipe unlock state and enforces queue slot capacity before starting a craft
   */
  static override async startCraft(userId: string, recipeId: string) {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) {
      throw new Error('Recipe not found');
    }

    // 1. Recipe unlock validation
    const unlocked = await this.isRecipeUnlocked(userId, recipeId);
    if (!unlocked) {
      throw new Error(`Recipe ${recipe.name} is locked. Unlock requirement not met.`);
    }

    // 2. Queue slot capacity validation
    const { activeCount, maxSlots } = await this.getQueueSlotStatus(userId);
    if (activeCount >= maxSlots) {
      throw new Error(
        `Crafting queue is full (${activeCount}/${maxSlots} active slots). Claim existing crafts or expand your queue.`
      );
    }

    return await super.startCraft(userId, recipeId);
  }

  static async trackCraftItem(userId: string, payload?: Record<string, unknown>) {
    await AnalyticsService.trackEvent('CRAFT_ITEM', { userId, payload });
  }
}
