import { prisma } from '../prisma';

export interface StreakReward {
  coins: number;
  gems: number;
}

export function calculateStreakReward(streakDay: number): StreakReward {
  // Day 1 to 7 cycle
  const cycleDay = ((streakDay - 1) % 7) + 1;
  switch (cycleDay) {
    case 1:
      return { coins: 50, gems: 0 };
    case 2:
      return { coins: 75, gems: 0 };
    case 3:
      return { coins: 100, gems: 0 };
    case 4:
      return { coins: 125, gems: 1 };
    case 5:
      return { coins: 150, gems: 1 };
    case 6:
      return { coins: 200, gems: 2 };
    case 7:
    default:
      return { coins: 300, gems: 5 }; // Weekly milestone bonus
  }
}

export class DailyLoginStreakService {
  /**
   * Retrieves user's streak status without claiming
   */
  static async getStreak(userId: string) {
    return await prisma.dailyLoginStreak.findUnique({
      where: { userId },
    });
  }

  /**
   * Evaluates login date, updates consecutive streak, and awards progression rewards
   */
  static async recordLogin(userId: string, now: Date = new Date()) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.dailyLoginStreak.findUnique({
        where: { userId },
      });

      const todayStr = now.toISOString().slice(0, 10);

      if (existing) {
        const lastStr = existing.lastLoginDate.toISOString().slice(0, 10);

        if (todayStr === lastStr) {
          // Already logged in and claimed today
          return {
            currentStreak: existing.currentStreak,
            longestStreak: existing.longestStreak,
            rewardCoins: 0,
            rewardGems: 0,
            isNewStreak: false,
            alreadyClaimedToday: true,
          };
        }

        const yesterday = new Date(now);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        let newStreak: number;
        if (lastStr === yesterdayStr) {
          // Consecutive daily login!
          newStreak = existing.currentStreak + 1;
        } else {
          // Streak broken (>1 day gap)
          newStreak = 1;
        }

        const newLongest = Math.max(existing.longestStreak, newStreak);
        const reward = calculateStreakReward(newStreak);

        const updated = await tx.dailyLoginStreak.update({
          where: { userId },
          data: {
            currentStreak: newStreak,
            longestStreak: newLongest,
            lastLoginDate: now,
          },
        });

        // Grant currency rewards
        await tx.user.update({
          where: { id: userId },
          data: {
            havenCoins: { increment: reward.coins },
            havenGems: { increment: reward.gems },
          },
        });

        await tx.transactionLog.create({
          data: {
            receiverId: userId,
            amount: reward.coins,
            type: 'DAILY_LOGIN_STREAK',
            source: `Streak Day ${newStreak}`,
          },
        });

        return {
          currentStreak: updated.currentStreak,
          longestStreak: updated.longestStreak,
          rewardCoins: reward.coins,
          rewardGems: reward.gems,
          isNewStreak: newStreak > 1,
          alreadyClaimedToday: false,
        };
      }

      // First time recording streak for user
      const reward = calculateStreakReward(1);
      const created = await tx.dailyLoginStreak.create({
        data: {
          userId,
          currentStreak: 1,
          longestStreak: 1,
          lastLoginDate: now,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          havenCoins: { increment: reward.coins },
          havenGems: { increment: reward.gems },
        },
      });

      await tx.transactionLog.create({
        data: {
          receiverId: userId,
          amount: reward.coins,
          type: 'DAILY_LOGIN_STREAK',
          source: 'Streak Day 1',
        },
      });

      return {
        currentStreak: created.currentStreak,
        longestStreak: created.longestStreak,
        rewardCoins: reward.coins,
        rewardGems: reward.gems,
        isNewStreak: false,
        alreadyClaimedToday: false,
      };
    });
  }
}
