import { TradeManager } from '../services/TradeManager';
import { prisma } from '../prisma';

export interface SecureTradeOffer {
  inventoryItemId: string;
  quantity: number;
}

export class SecureTradeSystem {
  /**
   * Validates that both parties hold the exact claimed items before allowing trade lock
   */
  public static async verifyInventoryOwnership(
    userId: string,
    items: SecureTradeOffer[]
  ): Promise<boolean> {
    for (const item of items) {
      const record = await prisma.inventory.findUnique({
        where: {
          userId_itemId: {
            userId,
            itemId: item.inventoryItemId,
          },
        },
      });

      if (!record || record.quantity < item.quantity) {
        return false;
      }
    }
    return true;
  }

  public static getTradeManager() {
    return TradeManager;
  }
}
