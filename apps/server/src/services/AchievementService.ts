import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export class AchievementService {
  /**
   * Checks and awards achievements based on triggered player actions
   */
  static async checkAndAward(userId: string, action: string, data?: any) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          achievements: true,
          fishCatches: true,
          pets: true,
          sentMessages: true,
        },
      });

      if (!user) return;

      const existingStamps = new Set(user.achievements.map((a) => a.stamp));

      const award = async (stampName: string) => {
        if (existingStamps.has(stampName)) return;

        await prisma.achievement.create({
          data: {
            userId,
            stamp: stampName,
          },
        });
        existingStamps.add(stampName);

        const io = getIO();
        if (io) {
          io.to(`user:${userId}`).emit(SOCKET_EVENTS.ACHIEVEMENT_UNLOCKED, {
            stamp: stampName,
          });
        }

        // Check if player has completed all 19 to award "Legend of Haven"
        if (existingStamps.size === 19 && !existingStamps.has('Legend of Haven')) {
          await award('Legend of Haven');
        }
      };

      // Evaluate rules
      switch (action) {
        case 'LOGIN':
          await award('First Step');
          break;

        case 'CATCH_FISH':
          if (data?.species === 'radiant_haven_koi' || data?.species === 'Radiant Haven Koi') {
            await award('Master Angler');
          }
          if (user.fishCatches.length >= 50) {
            await award('Fish and Chips');
          }
          break;

        case 'ADOPT_PET':
          await award('Pet Parent');
          if (data?.petType === 'BABY_DRAGON') {
            await award('Dragon Tamer');
          }
          break;

        case 'SIGN_GUESTBOOK': {
          const count = await prisma.guestbookEntry.count({ where: { authorId: userId } });
          if (count >= 10) await award('Social Butterfly');
          break;
        }

        case 'TIP_PLAYER': {
          const tips = await prisma.tipTransaction.aggregate({
            where: { senderId: userId },
            _sum: { amount: true },
          });
          if ((tips._sum.amount || 0) >= 1000) await award('Tip Royale');
          break;
        }

        case 'P2P_TRADE': {
          const tradeCount = await prisma.tradeLog.count({
            where: {
              OR: [{ initiatorId: userId }, { receiverId: userId }],
              status: 'COMPLETED',
            },
          });
          if (tradeCount >= 10) await award('Trading Post');
          break;
        }

        case 'CRAFT_ITEM': {
          const craftCount = await prisma.craftingQueue.count({
            where: { userId, claimed: true },
          });
          if (craftCount >= 20) await award('Craft Master');
          break;
        }

        case 'PLACE_FURNITURE': {
          const furnitureCount = await prisma.roomFurniture.count({
            where: { placedBy: userId },
          });
          if (furnitureCount >= 20) await award('Sanctuary Decorator');
          break;
        }

        case 'STREAK_UPDATE':
          if (data?.streak >= 7) await award('Streaker');
          if (data?.streak >= 30) await award('Loyal Haven');
          break;

        case 'GIFT_SENT': {
          const giftCount = await prisma.giftTransaction.count({ where: { senderId: userId } });
          if (giftCount >= 5) await award('Generous Soul');
          break;
        }

        case 'DOORBELL_ADMIT': {
          const admitCount = await prisma.roomAccessLog.count({
            where: { room: { ownerId: userId } },
          });
          if (admitCount >= 10) await award('Good Neighbor');
          break;
        }
      }
    } catch (err) {
      console.error('[AchievementService] Error checking achievement:', err);
    }
  }

  /**
   * Retrieves full public passport data for a user
   */
  static async getPassportData(targetUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        createdAt: true,
        isVIP: true,
        passportFrame: true,
        achievements: {
          select: { stamp: true, earnedAt: true },
        },
        _count: {
          select: {
            fishCatches: true,
            tipsReceived: true,
          },
        },
      },
    });

    if (!user) return null;

    const completedTrades = await prisma.tradeLog.count({
      where: {
        OR: [{ initiatorId: targetUserId }, { receiverId: targetUserId }],
        status: 'COMPLETED',
      },
    });

    return {
      userId: user.id,
      username: user.username,
      joinDate: user.createdAt.toISOString(),
      isVIP: user.isVIP,
      frameId: user.passportFrame?.frameId || 'default',
      stamps: user.achievements.map((a) => ({
        stamp: a.stamp,
        earnedAt: a.earnedAt.toISOString(),
      })),
      fishCount: user._count.fishCatches,
      totalTips: user._count.tipsReceived,
      completedTrades,
    };
  }
}
