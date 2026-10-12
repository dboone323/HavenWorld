import { prisma } from '../prisma';
import { redis } from '../redis';

export type LoftTag = 'cozy' | 'aesthetic' | 'party_vibes' | 'creative_build' | 'retro' | 'futuristic' | 'nature_haven';

export interface LoftReview {
  id: string;
  roomId: string;
  reviewerId: string;
  reviewerName: string;
  stars: number; // 1 to 5
  tags: LoftTag[];
  comment?: string;
  createdAt: number;
}

export interface LoftRatingSummary {
  roomId: string;
  totalReviews: number;
  averageRating: number;
  tagsCount: Record<string, number>;
  upvotes: number;
}

export interface LoftLeaderboardEntry {
  roomId: string;
  name: string;
  ownerName: string;
  score: number;
  rank: number;
}

export class LoftRatingService {
  private static userUpvotes = new Set<string>(); // "userId:roomId"
  private static roomReviews = new Map<string, LoftReview[]>(); // roomId -> reviews

  /**
   * Casts an upvote/like for a room with strict 1-vote-per-user deduplication
   */
  static async upvoteRoom(userId: string, roomId: string) {
    const key = `${userId}:${roomId}`;
    if (this.userUpvotes.has(key)) {
      throw new Error('You have already upvoted this loft');
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true, ownerId: true },
    });

    if (!room) throw new Error('Room not found');
    if (room.ownerId === userId) {
      throw new Error('Cannot upvote your own room');
    }

    this.userUpvotes.add(key);

    // Record as telemetry event
    await prisma.gameEvent.create({
      data: {
        event: 'LOFT_UPVOTE',
        userId,
        roomId,
      },
    });

    const totalUpvotes = await prisma.gameEvent.count({
      where: { event: 'LOFT_UPVOTE', roomId },
    });

    // Update weekly leaderboard score in Redis (+10 points per upvote)
    const weekKey = this.getCurrentWeekKey();
    await redis.zIncrBy(`loft:showcase:weekly:${weekKey}`, 10, roomId);

    return {
      roomId,
      totalUpvotes,
      hasUpvoted: true,
    };
  }

  /**
   * Submits a categorized 1-5 star review with feedback tags (1 review per 24 hours per visitor)
   */
  static async submitLoftRating(
    userId: string,
    roomId: string,
    payload: { stars: number; tags?: LoftTag[]; comment?: string }
  ): Promise<LoftReview> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, ownerId: true },
    });

    if (!room) throw new Error('Room not found');
    if (room.ownerId === userId) {
      throw new Error('Cannot rate your own loft');
    }

    const stars = Math.max(1, Math.min(5, Math.round(payload.stars)));
    const cooldownKey = `loft:review:cooldown:${userId}:${roomId}`;
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      throw new Error('You can only rate this loft once every 24 hours');
    }

    const reviewer = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    const validTags: LoftTag[] = [
      'cozy',
      'aesthetic',
      'party_vibes',
      'creative_build',
      'retro',
      'futuristic',
      'nature_haven',
    ];
    const filteredTags = (payload.tags || []).filter((t) => validTags.includes(t));

    const review: LoftReview = {
      id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      roomId,
      reviewerId: userId,
      reviewerName: reviewer?.username || 'Resident',
      stars,
      tags: filteredTags,
      comment: payload.comment ? payload.comment.trim().slice(0, 140) : undefined,
      createdAt: Date.now(),
    };

    const reviews = this.roomReviews.get(roomId) || [];
    reviews.push(review);
    this.roomReviews.set(roomId, reviews);

    // Set 24 hour cooldown in Redis
    await redis.set(cooldownKey, '1', { EX: 86400 });

    // Update weekly leaderboard score in Redis (+stars * 5 points)
    const weekKey = this.getCurrentWeekKey();
    await redis.zIncrBy(`loft:showcase:weekly:${weekKey}`, stars * 5, roomId);

    return review;
  }

  /**
   * Calculates comprehensive rating metrics and tag distribution for a loft
   */
  static async getRoomRatingSummary(roomId: string): Promise<LoftRatingSummary> {
    const reviews = this.roomReviews.get(roomId) || [];
    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? Number((reviews.reduce((acc, r) => acc + r.stars, 0) / totalReviews).toFixed(2))
      : 5.0;

    const tagsCount: Record<string, number> = {};
    for (const r of reviews) {
      for (const t of r.tags) {
        tagsCount[t] = (tagsCount[t] || 0) + 1;
      }
    }

    const upvotes = await prisma.gameEvent.count({
      where: { event: 'LOFT_UPVOTE', roomId },
    });

    return {
      roomId,
      totalReviews,
      averageRating,
      tagsCount,
      upvotes,
    };
  }

  /**
   * Retrieves top popular lofts for the current weekly showcase
   */
  static async getWeeklyLeaderboard(weekKey?: string, limit: number = 10): Promise<LoftLeaderboardEntry[]> {
    const targetWeek = weekKey || this.getCurrentWeekKey();
    const redisKey = `loft:showcase:weekly:${targetWeek}`;

    const rawList = await redis.zRangeWithScores(redisKey, 0, limit - 1, { REV: true });
    if (!rawList || rawList.length === 0) {
      // Fallback to trending lofts if current week has no ratings yet
      const trending = await this.getTrendingLofts(limit);
      return trending.map((t, idx) => ({
        roomId: t.roomId,
        name: t.name,
        ownerName: t.ownerName,
        score: t.upvotes * 10,
        rank: idx + 1,
      }));
    }

    const roomIds = rawList.map((item) => item.value);
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      include: { owner: { select: { username: true } } },
    });

    const roomMap = new Map(rooms.map((r) => [r.id, r]));

    return rawList.map((entry, idx) => {
      const room = roomMap.get(entry.value);
      return {
        roomId: entry.value,
        name: room?.name || 'Sanctuary Loft',
        ownerName: room?.owner?.username || 'Resident',
        score: Math.round(entry.score),
        rank: idx + 1,
      };
    });
  }

  /**
   * Retrieves trending lofts ordered by upvotes
   */
  static async getTrendingLofts(limit: number = 10) {
    const topRooms = await prisma.gameEvent.groupBy({
      by: ['roomId'],
      where: { event: 'LOFT_UPVOTE', roomId: { not: null } },
      _count: { roomId: true },
      orderBy: { _count: { roomId: 'desc' } },
      take: limit,
    });

    const roomIds = topRooms.map((r) => r.roomId!).filter(Boolean);
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      include: { owner: { select: { id: true, username: true } } },
    });

    const roomMap = new Map(rooms.map((r) => [r.id, r]));

    return topRooms.map((tr) => {
      const room = roomMap.get(tr.roomId!);
      return {
        roomId: tr.roomId!,
        name: room?.name || 'Sanctuary',
        ownerName: room?.owner?.username || 'Resident',
        upvotes: tr._count.roomId,
      };
    });
  }

  private static getCurrentWeekKey(): string {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo}`;
  }
}
