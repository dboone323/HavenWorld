import { prisma } from '../prisma';
import { redisClient } from '../redis';
import { GATHERING_NODES } from '@havenworld/shared';

export type { GatheringNode } from '@havenworld/shared';
export { GATHERING_NODES };

export class GatheringService {
  private static memoryCooldowns = new Map<string, number>();

  /**
   * Harvests a clickable resource node in a public room
   */
  static async harvestNode(userId: string, nodeId: string) {
    const node = GATHERING_NODES[nodeId];
    if (!node) {
      throw new Error(`Unknown resource node '${nodeId}'`);
    }

    const cooldownKey = `gather:cooldown:${userId}:${nodeId}`;
    const now = Date.now();

    // Check cooldown via Redis or fallback memory
    if (redisClient.isOpen) {
      const exists = await redisClient.get(cooldownKey);
      if (exists) {
        throw new Error(`Node '${node.name}' is on cooldown. Please wait before harvesting again.`);
      }
    } else {
      const expiresAt = this.memoryCooldowns.get(cooldownKey) || 0;
      if (now < expiresAt) {
        throw new Error(`Node '${node.name}' is on cooldown. Please wait before harvesting again.`);
      }
    }

    // Set cooldown
    if (redisClient.isOpen) {
      await redisClient.set(cooldownKey, '1', { EX: node.cooldownSeconds });
    } else {
      this.memoryCooldowns.set(cooldownKey, now + node.cooldownSeconds * 1000);
    }

    // Atomically award raw material to user's MaterialInventory
    const updatedInventory = await prisma.$transaction(async (tx) => {
      const dataUpdate: any = {};
      if (node.material === 'timber') dataUpdate.timber = { increment: node.yieldQuantity };
      if (node.material === 'scrap_metal') dataUpdate.scrapMetal = { increment: node.yieldQuantity };
      if (node.material === 'fabric') dataUpdate.fabric = { increment: node.yieldQuantity };
      if (node.material === 'crystal_shard') dataUpdate.crystalShard = { increment: node.yieldQuantity };

      const createData: any = {
        userId,
        timber: node.material === 'timber' ? node.yieldQuantity : 0,
        scrapMetal: node.material === 'scrap_metal' ? node.yieldQuantity : 0,
        fabric: node.material === 'fabric' ? node.yieldQuantity : 0,
        crystalShard: node.material === 'crystal_shard' ? node.yieldQuantity : 0,
      };

      return await tx.materialInventory.upsert({
        where: { userId },
        create: createData,
        update: dataUpdate,
      });
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      material: node.material,
      quantity: node.yieldQuantity,
      cooldownSeconds: node.cooldownSeconds,
      inventory: updatedInventory,
    };
  }
}
