import { prisma } from '../prisma';
import { redisClient } from '../redis';
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
        select: {
          id: true,
          achievements: { select: { stamp: true } },
          _count: {
            select: {
              fishCatches: true,
              pets: true,
            },
          },
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
          if (user._count.fishCatches >= 50) {
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

        case 'DISCOVER_SECRET_ROOM':
          await award('Secret Explorer');
          break;
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

    const stampsList = user.achievements.map((a) => ({
      stamp: a.stamp,
      earnedAt: a.earnedAt.toISOString(),
    }));

    const milestone = this.calculatePassportMilestone(stampsList.length);

    let featuredBadge: string | null = null;
    if (redisClient.isOpen) {
      featuredBadge = await redisClient.get(`user:featured_badge:${targetUserId}`);
    }

    return {
      userId: user.id,
      username: user.username,
      joinDate: user.createdAt.toISOString(),
      isVIP: user.isVIP,
      frameId: user.passportFrame?.frameId || 'default',
      featuredBadge: featuredBadge || milestone.badge,
      milestone,
      stamps: stampsList,
      fishCount: user._count.fishCatches,
      totalTips: user._count.tipsReceived,
      completedTrades,
    };
  }

  /**
   * Evaluates passport milestone tier and percentage completion
   */
  static calculatePassportMilestone(stampCount: number) {
    const TOTAL_STAMPS = 20;
    const clampedCount = Math.max(0, Math.min(TOTAL_STAMPS, stampCount));
    const percentage = Math.round((clampedCount / TOTAL_STAMPS) * 100);

    if (clampedCount >= 20) {
      return {
        tier: 'DIAMOND',
        badge: 'Legend of Haven',
        completionPercentage: 100,
        nextMilestoneCount: null,
      };
    }
    if (clampedCount >= 15) {
      return {
        tier: 'PLATINUM',
        badge: 'Haven Luminary',
        completionPercentage: percentage,
        nextMilestoneCount: 20,
      };
    }
    if (clampedCount >= 10) {
      return {
        tier: 'GOLD',
        badge: 'Haven Champion',
        completionPercentage: percentage,
        nextMilestoneCount: 15,
      };
    }
    if (clampedCount >= 5) {
      return {
        tier: 'SILVER',
        badge: 'Haven Pioneer',
        completionPercentage: percentage,
        nextMilestoneCount: 10,
      };
    }
    return {
      tier: 'BRONZE',
      badge: 'Haven Explorer',
      completionPercentage: percentage,
      nextMilestoneCount: 5,
    };
  }

  /**
   * Sets user's customized passport frame with unlock requirement validation
   */
  static async setPassportFrame(userId: string, frameId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { achievements: true },
    });

    if (!user) throw new Error('User not found');

    const stamps = new Set(user.achievements.map((a) => a.stamp));

    // Validate unlock requirements
    switch (frameId) {
      case 'default':
        break; // open to all
      case 'golden_vip':
        if (!user.isVIP) throw new Error('Golden VIP frame requires active VIP membership');
        break;
      case 'master_angler':
        if (!stamps.has('Master Angler')) throw new Error('Requires Master Angler achievement');
        break;
      case 'secret_explorer':
        if (!stamps.has('Secret Explorer')) throw new Error('Requires Secret Explorer achievement');
        break;
      case 'social_butterfly':
        if (!stamps.has('Social Butterfly')) throw new Error('Requires Social Butterfly achievement');
        break;
      case 'grand_legend':
        if (!stamps.has('Legend of Haven')) throw new Error('Requires Legend of Haven achievement');
        break;
      default:
        throw new Error(`Unknown passport frame ID: "${frameId}"`);
    }

    const updatedFrame = await prisma.passportFrame.upsert({
      where: { userId },
      update: { frameId },
      create: { userId, frameId },
    });

    return updatedFrame;
  }

  /**
   * Sets player's featured profile badge
   */
  static async setFeaturedBadge(userId: string, badgeName: string) {
    if (!badgeName || !badgeName.trim()) {
      throw new Error('Badge name is required');
    }

    const clean = badgeName.trim().slice(0, 32);
    if (redisClient.isOpen) {
      await redisClient.set(`user:featured_badge:${userId}`, clean);
    }
    return { userId, featuredBadge: clean };
  }
}
