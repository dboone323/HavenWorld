import { prisma } from '../prisma';
import {
  CRAFTING_RECIPES,
  calculateRecycleYield,
  RawMaterial,
  CraftingRecipe,
} from '@havenworld/shared';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

export class WorkshopService {
  /**
   * Recycles an inventory item into raw crafting materials
   */
  static async recycleItem(userId: string, inventoryItemId: string) {
    return await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { id: inventoryItemId },
        include: { item: true },
      });

      if (!inventory || inventory.userId !== userId || inventory.quantity < 1) {
        throw new Error('Item not found in inventory');
      }

      // Determine material type
      let primaryMaterial: RawMaterial = 'timber';
      const name = inventory.item.name.toLowerCase();
      if (name.includes('clock') || name.includes('metal') || name.includes('tv')) {
        primaryMaterial = 'scrap_metal';
      } else if (name.includes('sofa') || name.includes('rug') || name.includes('shirt')) {
        primaryMaterial = 'fabric';
      } else if (name.includes('lamp') || name.includes('crystal') || name.includes('painting')) {
        primaryMaterial = 'crystal_shard';
      }

      const yieldCount = calculateRecycleYield(inventory.item.price || 20, primaryMaterial);

      // Decrement inventory
      if (inventory.quantity === 1) {
        await tx.inventory.delete({ where: { id: inventory.id } });
      } else {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: 1 } },
        });
      }

      // Credit material inventory
      const materials = await tx.materialInventory.upsert({
        where: { userId },
        create: {
          userId,
          scrapMetal: primaryMaterial === 'scrap_metal' ? yieldCount : 0,
          timber: primaryMaterial === 'timber' ? yieldCount : 0,
          fabric: primaryMaterial === 'fabric' ? yieldCount : 0,
          crystalShard: primaryMaterial === 'crystal_shard' ? yieldCount : 0,
        },
        update: {
          scrapMetal: primaryMaterial === 'scrap_metal' ? { increment: yieldCount } : undefined,
          timber: primaryMaterial === 'timber' ? { increment: yieldCount } : undefined,
          fabric: primaryMaterial === 'fabric' ? { increment: yieldCount } : undefined,
          crystalShard: primaryMaterial === 'crystal_shard' ? { increment: yieldCount } : undefined,
        },
      });

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.RECYCLE_RESULT, {
          material: primaryMaterial,
          yieldCount,
        });
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.MATERIALS_UPDATE, materials);
      }

      return {
        material: primaryMaterial,
        yieldCount,
        materials,
      };
    });
  }

  /**
   * Starts crafting a recipe and puts it into the player's CraftingQueue
   */
  static async startCraft(userId: string, recipeId: string) {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) throw new Error('Recipe not found');

    return await prisma.$transaction(async (tx) => {
      const materials = await tx.materialInventory.findUnique({ where: { userId } });
      if (!materials) throw new Error('No raw materials found in workshop storage');

      // Verify and deduct required materials
      for (const req of recipe.materials) {
        if (req.type === 'scrap_metal' && materials.scrapMetal < req.qty) {
          throw new Error(`Insufficient scrap metal (need ${req.qty})`);
        }
        if (req.type === 'timber' && materials.timber < req.qty) {
          throw new Error(`Insufficient timber (need ${req.qty})`);
        }
        if (req.type === 'fabric' && materials.fabric < req.qty) {
          throw new Error(`Insufficient fabric (need ${req.qty})`);
        }
        if (req.type === 'crystal_shard' && materials.crystalShard < req.qty) {
          throw new Error(`Insufficient crystal shards (need ${req.qty})`);
        }
      }

      // Deduct materials
      const updateData: any = {};
      for (const req of recipe.materials) {
        if (req.type === 'scrap_metal') updateData.scrapMetal = { decrement: req.qty };
        if (req.type === 'timber') updateData.timber = { decrement: req.qty };
        if (req.type === 'fabric') updateData.fabric = { decrement: req.qty };
        if (req.type === 'crystal_shard') updateData.crystalShard = { decrement: req.qty };
      }

      const updatedMaterials = await tx.materialInventory.update({
        where: { userId },
        data: updateData,
      });

      const completesAt = new Date(Date.now() + recipe.craftingMinutes * 60_000);
      const queueItem = await tx.craftingQueue.create({
        data: {
          userId,
          recipeId,
          completesAt,
          claimed: false,
        },
      });

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.CRAFT_STARTED, {
          queueId: queueItem.id,
          recipeId,
          completesAt: completesAt.toISOString(),
        });
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.MATERIALS_UPDATE, updatedMaterials);
      }

      return queueItem;
    });
  }

  /**
   * Claims a completed crafted item
   */
  static async claimCraft(userId: string, queueId: string) {
    return await prisma.$transaction(async (tx) => {
      const queueItem = await tx.craftingQueue.findUnique({ where: { id: queueId } });
      if (!queueItem || queueItem.userId !== userId) throw new Error('Crafting queue item not found');
      if (queueItem.claimed) throw new Error('Item already claimed');
      if (new Date() < queueItem.completesAt) throw new Error('Item is still crafting');

      const recipe = CRAFTING_RECIPES.find((r) => r.id === queueItem.recipeId);
      if (!recipe) throw new Error('Recipe not found');

      // Ensure item exists in DB
      let item = await tx.item.findUnique({ where: { id: recipe.outputItemId } });
      if (!item) {
        item = await tx.item.create({
          data: {
            id: recipe.outputItemId,
            name: recipe.name,
            description: recipe.description,
            category: 'FURNITURE',
            rarity: recipe.rarity,
            spriteKey: recipe.outputItemId.replace('furniture-', ''),
          },
        });
      }

      // Add to inventory
      await tx.inventory.upsert({
        where: { userId_itemId: { userId, itemId: item.id } },
        create: { userId, itemId: item.id, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });

      // Mark claimed
      await tx.craftingQueue.update({
        where: { id: queueId },
        data: { claimed: true },
      });

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.CRAFT_COMPLETE, {
          item,
        });
      }

      await QuestService.incrementProgress(userId, 'CRAFT_ITEM', 1);
      await AchievementService.checkAndAward(userId, 'CRAFT_ITEM');

      return item;
    });
  }

  /**
   * Cron entry point (every 5 minutes): announces crafts that finished while the
   * owner was offline. `notifiedAt` guarantees each queue row is announced once,
   * so a player who is online at completion time gets exactly one notification
   * whether it comes from here or from their own `claimCraft` call.
   */
  static async processCompletedCrafts(now: Date = new Date()): Promise<number> {
    const due = await prisma.craftingQueue.findMany({
      where: { claimed: false, notifiedAt: null, completesAt: { lte: now } },
      take: 500,
    });

    if (due.length === 0) return 0;

    const io = getIO();
    if (io) {
      for (const row of due) {
        const recipe = CRAFTING_RECIPES.find((r) => r.id === row.recipeId);
        io.to(`user:${row.userId}`).emit(SOCKET_EVENTS.CRAFT_COMPLETE, {
          queueId: row.id,
          recipeId: row.recipeId,
          recipeName: recipe?.name ?? row.recipeId,
        });
      }
    }

    await prisma.craftingQueue.updateMany({
      where: { id: { in: due.map((r) => r.id) } },
      data: { notifiedAt: now },
    });

    console.log(`[Workshop] Announced ${due.length} completed craft(s)`);
    return due.length;
  }
}
