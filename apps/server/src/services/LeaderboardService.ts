import { prisma } from '../prisma';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
}

export class LeaderboardService {
  /**
   * Retrieves rankings for plaza display boards across multiple categories
   */
  static async getLeaderboard(
    category: 'RICHEST_PLAYERS' | 'MASTER_CHEFS' | 'MASTER_ANGLERS' | 'TOP_DECORATORS'
  ): Promise<LeaderboardEntry[]> {
    if (category === 'RICHEST_PLAYERS') {
      const users = await prisma.user.findMany({
        where: { isBanned: false },
        orderBy: { havenCoins: 'desc' },
        take: 10,
        select: { id: true, username: true, havenCoins: true },
      });

      return users.map((u, i) => ({
        rank: i + 1,
        userId: u.id,
        username: u.username,
        score: u.havenCoins,
      }));
    }

    if (category === 'MASTER_CHEFS') {
      const topChefs = await prisma.minigameSession.groupBy({
        by: ['userId'],
        where: { gameType: 'PIZZA_CHEF' },
        _sum: { coinsEarned: true },
        orderBy: { _sum: { coinsEarned: 'desc' } },
        take: 10,
      });

      const userIds = topChefs.map((c) => c.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.username]));

      return topChefs.map((c, i) => ({
        rank: i + 1,
        userId: c.userId,
        username: userMap.get(c.userId) || 'Anonymous Chef',
        score: c._sum.coinsEarned || 0,
      }));
    }

    if (category === 'MASTER_ANGLERS') {
      const anglers = await prisma.fishingLeaderboard.findMany({
        orderBy: { weightLbs: 'desc' },
        take: 10,
        include: { user: { select: { id: true, username: true } } },
      });

      return anglers.map((a, i) => ({
        rank: i + 1,
        userId: a.userId,
        username: a.user.username,
        score: Math.round(a.weightLbs * 10) / 10,
      }));
    }

    if (category === 'TOP_DECORATORS') {
      const decorators = await prisma.roomFurniture.groupBy({
        by: ['placedBy'],
        _count: { placedBy: true },
        orderBy: { _count: { placedBy: 'desc' } },
        take: 10,
      });

      const userIds = decorators.map((d) => d.placedBy);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.username]));

      return decorators.map((d, i) => ({
        rank: i + 1,
        userId: d.placedBy,
        username: userMap.get(d.placedBy) || 'Decorator',
        score: d._count?.placedBy ?? 0,
      }));
    }

    throw new Error(`Unknown leaderboard category: ${category}`);
  }
}
