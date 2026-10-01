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
   * Dispatches a postal gift parcel scheduled to arrive at deliverAt.
   * Verifies ownership, tradeability, and deducts 1 item from sender inventory into postal escrow.
   */
  static async sendDelayedParcel(
    senderId: string,
    recipientId: string,
    itemId: string,
    message: string,
    delayMinutes: number = 60
  ): Promise<DelayedParcel> {
    if (senderId === recipientId) {
      throw new Error('You cannot send a parcel to yourself');
    }

    await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { userId_itemId: { userId: senderId, itemId } },
        include: { item: true },
      });

      if (!inventory || inventory.quantity < 1) {
        throw new Error('You do not own this item in your inventory');
      }

      if (!inventory.item.isTradeable) {
        throw new Error('This item is not tradeable and cannot be mailed');
      }

      if (inventory.quantity === 1) {
        const avatar = await tx.avatar.findUnique({ where: { userId: senderId } });
        if (avatar) {
          const equipped = [
            avatar.outfitHead,
            avatar.outfitFace,
            avatar.outfitBody,
            avatar.outfitLegs,
            avatar.outfitFeet,
            avatar.outfitBack,
            avatar.outfitHand,
          ];
          if (equipped.includes(itemId)) {
            throw new Error('Cannot mail an equipped item. Please unequip it first.');
          }
        }
        await tx.inventory.delete({ where: { id: inventory.id } });
      } else {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: 1 } },
        });
      }
    });

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
   * Mailbox view for a user: parcels in transit to them, parcels they sent,
   * and the last 10 parcels delivered to them (roadmap §3q mailbox widget).
   */
  static getInboxFor(userId: string): {
    incoming: DelayedParcel[];
    outgoing: DelayedParcel[];
    received: DelayedParcel[];
  } {
    const incoming: DelayedParcel[] = [];
    const outgoing: DelayedParcel[] = [];
    const received: DelayedParcel[] = [];

    for (const parcel of this.parcelQueue.values()) {
      if (parcel.recipientId === userId && !parcel.delivered) incoming.push(parcel);
      if (parcel.senderId === userId) outgoing.push(parcel);
      if (parcel.recipientId === userId && parcel.delivered) received.push(parcel);
    }

    return { incoming, outgoing, received: received.slice(-10) };
  }

  /**
   * Processes all parcels whose delivery timestamp has arrived
   */
  static async processArrivedMail(now: number = Date.now()): Promise<DelayedParcel[]> {
    const arrived: DelayedParcel[] = [];

    for (const [, parcel] of this.parcelQueue.entries()) {
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

    // Prune delivered parcels beyond the most recent 200 to prevent unbounded memory growth
    const deliveredIds: string[] = [];
    for (const [id, parcel] of this.parcelQueue.entries()) {
      if (parcel.delivered) deliveredIds.push(id);
    }
    while (deliveredIds.length > 200) {
      const oldestId = deliveredIds.shift();
      if (oldestId) this.parcelQueue.delete(oldestId);
    }

    return arrived;
  }
}
