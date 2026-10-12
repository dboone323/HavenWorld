import { prisma } from '../../prisma';
import { LoftRatingService } from '../LoftRatingService';
import { redis, connectRedis, disconnectRedis } from '../../redis';

describe('Batch 45: Loft Showcase Visitor Ratings & Weekly Leaderboards', () => {
  let ownerUser: any;
  let visitorUser: any;
  let testRoom: any;

  // The weekly showcase leaderboard is a Redis sorted-set keyed by ISO week with
  // no TTL. Prior runs leave stale room members behind, which can push this run's
  // room out of the top-N window and make the leaderboard assertion flaky. Clear
  // the current week's key up front so the suite is hermetic and deterministic.
  let weeklyKey: string;

  beforeAll(async () => {
    await connectRedis();

    ownerUser = await prisma.user.create({
      data: {
        username: `loftowner_${Date.now()}`,
        email: `loftowner_${Date.now()}@example.com`,
        passwordHash: 'hash',
      },
    });

    visitorUser = await prisma.user.create({
      data: {
        username: `visitor_${Date.now()}`,
        email: `visitor_${Date.now()}@example.com`,
        passwordHash: 'hash',
      },
    });

    testRoom = await prisma.room.create({
      data: {
        name: 'Cozy Botanical Penthouse',
        ownerId: ownerUser.id,
      },
    });

    weeklyKey = `loft:showcase:weekly:${(LoftRatingService as any).getCurrentWeekKey()}`;
    await redis.del(weeklyKey).catch(() => {});
  });

  afterAll(async () => {
    if (testRoom?.id) {
      await prisma.gameEvent.deleteMany({ where: { roomId: testRoom.id } }).catch(() => {});
      await prisma.room.delete({ where: { id: testRoom.id } }).catch(() => {});
    }
    if (visitorUser?.id) {
      // Clear the 24h rating cooldown so repeated runs stay deterministic.
      await redis.del(`loft:review:cooldown:${visitorUser.id}:${testRoom?.id}`).catch(() => {});
      await prisma.user.delete({ where: { id: visitorUser.id } }).catch(() => {});
    }
    if (ownerUser?.id) await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
    if (weeklyKey) await redis.del(weeklyKey).catch(() => {});
    await disconnectRedis();
  });

  it('rejects owner rating their own room', async () => {
    await expect(
      LoftRatingService.submitLoftRating(ownerUser.id, testRoom.id, { stars: 5 })
    ).rejects.toThrow(/Cannot rate your own loft/i);
  });

  it('submits a 5-star visitor rating with design feedback tags and comment', async () => {
    const review = await LoftRatingService.submitLoftRating(visitorUser.id, testRoom.id, {
      stars: 5,
      tags: ['cozy', 'nature_haven', 'aesthetic'],
      comment: 'Incredible plant placement and relaxing atmospheric vibes!',
    });

    expect(review).toBeDefined();
    expect(review.stars).toBe(5);
    expect(review.tags).toContain('cozy');
    expect(review.tags).toContain('nature_haven');
    expect(review.reviewerName).toBe(visitorUser.username);
  });

  it('enforces 24-hour rating cooldown per visitor per room', async () => {
    await expect(
      LoftRatingService.submitLoftRating(visitorUser.id, testRoom.id, { stars: 4 })
    ).rejects.toThrow(/once every 24 hours/i);
  });

  it('calculates aggregate rating metrics and tags distribution', async () => {
    const summary = await LoftRatingService.getRoomRatingSummary(testRoom.id);
    expect(summary.totalReviews).toBe(1);
    expect(summary.averageRating).toBe(5);
    expect(summary.tagsCount['cozy']).toBe(1);
    expect(summary.tagsCount['nature_haven']).toBe(1);
  });

  it('retrieves weekly showcase leaderboard with calculated points', async () => {
    const leaderboard = await LoftRatingService.getWeeklyLeaderboard();
    expect(Array.isArray(leaderboard)).toBe(true);
    const roomEntry = leaderboard.find((e) => e.roomId === testRoom.id);
    expect(roomEntry).toBeDefined();
    expect(roomEntry?.score).toBeGreaterThan(0);
  });
});
