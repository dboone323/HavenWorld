import { prisma } from '../prisma';
import { redisClient } from '../redis';
import { moderateMessage } from './ModerationService';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

export interface SentimentAnalysisResult {
  allowed: boolean;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  spamFlags: string[];
}

export class GuestbookService {
  /**
   * Evaluates text for spam patterns, character flooding, and sentiment
   */
  static analyzeSentimentAndSpam(message: string): SentimentAnalysisResult {
    const spamFlags: string[] = [];
    const text = (message || '').trim();

    // 1. URL / Link spam detection
    if (/https?:\/\/|www\.|discord\.gg|t\.me/i.test(text)) {
      spamFlags.push('LINK_PROHIBITED');
    }

    // 2. Character repetition flooding (e.g. "aaaaaa", "!!!!!!")
    if (/(.)\1{4,}/i.test(text)) {
      spamFlags.push('CHARACTER_FLOODING');
    }

    // 3. Phishing / Scam phrases
    if (/free coins|free gems|giveaway scam|hacked/i.test(text)) {
      spamFlags.push('SPAM_PHRASE');
    }

    // 4. Sentiment scoring
    const positiveTokens = ['love', 'awesome', 'great', 'cozy', 'cool', 'beautiful', 'nice', 'welcome', 'favorite', 'clean', 'vibes', 'sweet'];
    const negativeTokens = ['ugly', 'terrible', 'worst', 'hate', 'boring', 'trash', 'gross', 'bad'];

    const words = text.toLowerCase().split(/\s+/);
    let positiveScore = 0;
    let negativeScore = 0;

    for (const word of words) {
      if (positiveTokens.some((t) => word.includes(t))) positiveScore++;
      if (negativeTokens.some((t) => word.includes(t))) negativeScore++;
    }

    let sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' = 'NEUTRAL';
    if (positiveScore > negativeScore) sentiment = 'POSITIVE';
    else if (negativeScore > positiveScore) sentiment = 'NEGATIVE';

    return {
      allowed: spamFlags.length === 0,
      sentiment,
      spamFlags,
    };
  }

  /**
   * Checks and sets 30-second rate limit cooldown in Redis
   */
  static async checkRateLimit(roomId: string, authorId: string): Promise<boolean> {
    if (!redisClient.isOpen) return true;
    const redisKey = `guestbook:ratelimit:${roomId}:${authorId}`;
    const exists = await redisClient.get(redisKey);
    if (exists) return false;

    await redisClient.set(redisKey, '1', { EX: 30 }); // 30-second cooldown
    return true;
  }

  /**
   * Signs a loft's guestbook with a friendly message (max 120 chars)
   */
  static async signBook(roomId: string, authorId: string, message: string) {
    if (!message || message.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }

    const trimmed = message.trim().slice(0, 120);

    // Spam and sentiment analysis
    const analysis = this.analyzeSentimentAndSpam(trimmed);
    if (!analysis.allowed) {
      throw new Error(`Message rejected due to spam policy: ${analysis.spamFlags.join(', ')}`);
    }

    // Rate limit cooldown check
    const allowedByRateLimit = await this.checkRateLimit(roomId, authorId);
    if (!allowedByRateLimit) {
      throw new Error('Guestbook cooldown active (please wait before signing again)');
    }

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
      io.to(roomId).emit(SOCKET_EVENTS.GUESTBOOK_SIGNED, {
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
   * Pins an entry to the top of the loft's guestbook (room owner only)
   */
  static async pinEntry(roomId: string, entryId: string, requesterId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== requesterId) {
      throw new Error('Only the room owner can pin guestbook entries');
    }

    const entry = await prisma.guestbookEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.roomId !== roomId) {
      throw new Error('Entry not found in this room');
    }

    const redisKey = `guestbook:pinned:${roomId}`;
    if (redisClient.isOpen) {
      await redisClient.set(redisKey, entryId);
    }

    return { pinned: true, entryId, roomId };
  }

  /**
   * Unpins the current pinned guestbook entry (room owner only)
   */
  static async unpinEntry(roomId: string, requesterId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== requesterId) {
      throw new Error('Only the room owner can unpin guestbook entries');
    }

    const redisKey = `guestbook:pinned:${roomId}`;
    if (redisClient.isOpen) {
      await redisClient.del(redisKey);
    }

    return { unpinned: true, roomId };
  }

  /**
   * Returns a paginated list of guestbook entries with pinned priority
   */
  static async getPage(roomId: string, page = 1, pageSize = 10) {
    const take = Math.min(50, Math.max(1, pageSize));
    const skip = Math.max(0, (page - 1) * take);

    const redisKey = `guestbook:pinned:${roomId}`;
    let pinnedId: string | null = null;
    if (redisClient.isOpen) {
      pinnedId = await redisClient.get(redisKey);
    }

    const [entries, total] = await Promise.all([
      prisma.guestbookEntry.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.guestbookEntry.count({ where: { roomId } }),
    ]);

    const formatted = entries.map((e) => ({
      id: e.id,
      roomId: e.roomId,
      authorId: e.authorId,
      authorName: e.authorName,
      authorAvatar: e.authorAvatar,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
      isPinned: e.id === pinnedId,
    }));

    // If pinned entry is present, sort it to the top
    formatted.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

    return {
      entries: formatted,
      page,
      pageSize: take,
      totalPages: Math.ceil(total / take) || 1,
      totalEntries: total,
      pinnedId,
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
