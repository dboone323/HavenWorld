import { prisma } from '../prisma';

export interface DelayedParcel {
  id: string;
  senderId: string;
  recipientId: string;
  itemId: string;
  message: string;
  deliverAt: number;
  delivered: boolean;
}

export class DelayedMailService {
  private static parcelQueue = new Map<string, DelayedParcel>();

  /**
   * Dispatches a postal gift parcel scheduled to arrive at deliverAt
   */
  static async sendDelayedParcel(
    senderId: string,
    recipientId: string,
    itemId: string,
    message: string,
    delayMinutes: number = 60
  ): Promise<DelayedParcel> {
    const id = `parcel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const deliverAt = Date.now() + delayMinutes * 60_000;

    const parcel: DelayedParcel = {
      id,
      senderId,
      recipientId,
      itemId,
      message: message.trim().slice(0, 200),
      deliverAt,
      delivered: false,
    };

    this.parcelQueue.set(id, parcel);
    return parcel;
  }

  /**
   * Processes all parcels whose delivery timestamp has arrived
   */
  static async processArrivedMail(now: number = Date.now()): Promise<DelayedParcel[]> {
    const arrived: DelayedParcel[] = [];

    for (const [id, parcel] of this.parcelQueue.entries()) {
      if (!parcel.delivered && parcel.deliverAt <= now) {
        parcel.delivered = true;
        arrived.push(parcel);

        // Ensure item arrives in recipient inventory
        await prisma.inventory.upsert({
          where: { userId_itemId: { userId: parcel.recipientId, itemId: parcel.itemId } },
          create: { userId: parcel.recipientId, itemId: parcel.itemId, quantity: 1 },
          update: { quantity: { increment: 1 } },
        });

        // Record gift transaction
        await prisma.giftTransaction.create({
          data: {
            senderId: parcel.senderId,
            receiverId: parcel.recipientId,
            itemId: parcel.itemId,
            message: parcel.message,
          },
        });
      }
    }

    return arrived;
  }
}
