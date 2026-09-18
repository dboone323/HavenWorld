import { prisma } from '../prisma';
import { moderateMessage } from './ModerationService';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

export class GuestbookService {
  /**
   * Signs a loft's guestbook with a friendly message (max 120 chars)
   */
  static async signBook(roomId: string, authorId: string, message: string) {
    if (!message || message.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }

    const trimmed = message.trim().slice(0, 120);
    const cleanedMessage = moderateMessage(trimmed).filtered;

    const author = await prisma.user.findUnique({
      where: { id: authorId },
      include: { avatar: true },
    });

    if (!author) throw new Error('Author not found');

    const entry = await prisma.guestbookEntry.create({
      data: {
        roomId,
        authorId,
        authorName: author.username,
        authorAvatar: (author.avatar?.topColor || '#4ecdc4') as string,
        message: cleanedMessage,
      },
    });

    // Notify room occupants
    const io = getIO();
    if (io) {
      io.to(`room:${roomId}`).emit(SOCKET_EVENTS.GUESTBOOK_SIGNED, {
        entry: {
          id: entry.id,
          roomId: entry.roomId,
          authorId: entry.authorId,
          authorName: entry.authorName,
          authorAvatar: entry.authorAvatar,
          message: entry.message,
          createdAt: entry.createdAt.toISOString(),
        },
      });
    }

    // Quest and achievement progress
    await QuestService.incrementProgress(authorId, 'SIGN_GUESTBOOK', 1);
    await AchievementService.checkAndAward(authorId, 'SIGN_GUESTBOOK');

    return entry;
  }

  /**
   * Deletes a guestbook entry (room owner only)
   */
  static async deleteEntry(entryId: string, requesterId: string) {
    const entry = await prisma.guestbookEntry.findUnique({
      where: { id: entryId },
      include: { room: true },
    });

    if (!entry) throw new Error('Entry not found');
    if (entry.room.ownerId !== requesterId) {
      throw new Error('Only the room owner can delete guestbook entries');
    }

    return await prisma.guestbookEntry.delete({ where: { id: entryId } });
  }

  /**
   * Returns a paginated list of guestbook entries (10 per page, newest first)
   */
  static async getPage(roomId: string, page = 1) {
    const take = 10;
    const skip = Math.max(0, (page - 1) * take);

    const [entries, total] = await Promise.all([
      prisma.guestbookEntry.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.guestbookEntry.count({ where: { roomId } }),
    ]);

    return {
      entries: entries.map((e) => ({
        id: e.id,
        roomId: e.roomId,
        authorId: e.authorId,
        authorName: e.authorName,
        authorAvatar: e.authorAvatar,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      })),
      page,
      totalPages: Math.ceil(total / take) || 1,
      totalEntries: total,
    };
  }

  /**
   * Tips the owner of a loft using HavenCoins with atomic balance transfer
   */
  static async tipOwner(senderId: string, roomId: string, amount: number) {
    const validAmounts = [10, 25, 50, 100, 250, 500];
    if (!validAmounts.includes(amount)) {
      throw new Error(`Invalid tip amount. Must be one of: ${validAmounts.join(', ')}`);
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.ownerId) {
      throw new Error('Room or room owner not found');
    }

    const receiverId = room.ownerId;
    if (senderId === receiverId) {
      throw new Error('You cannot tip your own loft');
    }

    return await prisma.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({ where: { id: senderId } });
      if (!sender || sender.havenCoins < amount) {
        throw new Error('Insufficient HavenCoins balance');
      }

      // Deduct from sender
      const updatedSender = await tx.user.update({
        where: { id: senderId },
        data: { havenCoins: { decrement: amount } },
        select: { id: true, havenCoins: true, username: true },
      });

      // Credit receiver
      await tx.user.update({
        where: { id: receiverId },
        data: { havenCoins: { increment: amount } },
      });

      // Log transaction
      const tipRecord = await tx.tipTransaction.create({
        data: {
          senderId,
          receiverId,
          amount,
          roomId,
        },
      });

      const io = getIO();
      if (io) {
        // Real-time alert to the loft owner
        io.to(`user:${receiverId}`).emit(SOCKET_EVENTS.TIP_RECEIVED, {
          amount,
          senderName: updatedSender.username,
          roomId,
        });

        // Confirmation to sender
        io.to(`user:${senderId}`).emit(SOCKET_EVENTS.TIP_SUCCESS, {
          newBalance: updatedSender.havenCoins,
          amount,
        });
      }

      // Track quest & achievement progress
      await QuestService.incrementProgress(senderId, 'TIP_PLAYER', 1);
      await AchievementService.checkAndAward(senderId, 'TIP_PLAYER', { amount });

      return {
        success: true,
        newBalance: updatedSender.havenCoins,
        tip: tipRecord,
      };
    });
  }
}
