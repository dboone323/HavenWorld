import { DailyLoginStreakService, calculateStreakReward } from '../DailyLoginStreakService';
import { SeasonalEventService } from '../SeasonalEventService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('DailyLoginStreakService', () => {
  it('calculates tiered streak rewards correctly across 7-day cycle', () => {
    expect(calculateStreakReward(1)).toEqual({ coins: 50, gems: 0 });
    expect(calculateStreakReward(2)).toEqual({ coins: 75, gems: 0 });
    expect(calculateStreakReward(3)).toEqual({ coins: 100, gems: 0 });
    expect(calculateStreakReward(4)).toEqual({ coins: 125, gems: 1 });
    expect(calculateStreakReward(5)).toEqual({ coins: 150, gems: 1 });
    expect(calculateStreakReward(6)).toEqual({ coins: 200, gems: 2 });
    expect(calculateStreakReward(7)).toEqual({ coins: 300, gems: 5 });
    // Day 8 wraps to Day 1
    expect(calculateStreakReward(8)).toEqual({ coins: 50, gems: 0 });
  });

  it('records first login, prevents same-day double claim, and advances consecutive streaks', async () => {
    const user = await createTestUser({ havenCoins: 0, havenGems: 0 });

    const day1 = new Date('2026-10-01T12:00:00Z');
    const firstResult = await DailyLoginStreakService.recordLogin(user.id, day1);
    expect(firstResult.currentStreak).toBe(1);
    expect(firstResult.longestStreak).toBe(1);
    expect(firstResult.rewardCoins).toBe(50);
    expect(firstResult.alreadyClaimedToday).toBe(false);

    // Same day claim attempt
    const sameDay = new Date('2026-10-01T18:30:00Z');
    const sameDayResult = await DailyLoginStreakService.recordLogin(user.id, sameDay);
    expect(sameDayResult.currentStreak).toBe(1);
    expect(sameDayResult.rewardCoins).toBe(0);
    expect(sameDayResult.alreadyClaimedToday).toBe(true);

    // Consecutive day claim (Day 2)
    const day2 = new Date('2026-10-02T09:15:00Z');
    const day2Result = await DailyLoginStreakService.recordLogin(user.id, day2);
    expect(day2Result.currentStreak).toBe(2);
    expect(day2Result.longestStreak).toBe(2);
    expect(day2Result.rewardCoins).toBe(75);
    expect(day2Result.alreadyClaimedToday).toBe(false);

    // Broken streak (skipping to Day 5)
    const day5 = new Date('2026-10-05T10:00:00Z');
    const resetResult = await DailyLoginStreakService.recordLogin(user.id, day5);
    expect(resetResult.currentStreak).toBe(1);
    expect(resetResult.longestStreak).toBe(2); // longest streak preserved
    expect(resetResult.rewardCoins).toBe(50);

    // Cleanup
    await prisma.transactionLog.deleteMany({ where: { receiverId: user.id } });
    await prisma.dailyLoginStreak.deleteMany({ where: { userId: user.id } });
    await prisma.avatar.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe('SeasonalEventService Leaderboard and Archiving', () => {
  it('correctly ranks participants and archives podium bonuses', async () => {
    const user1 = await createTestUser({ havenCoins: 100 });
    const user2 = await createTestUser({ havenCoins: 100 });
    const user3 = await createTestUser({ havenCoins: 100 });

    const event = await prisma.seasonalEvent.create({
      data: {
        name: 'Autumn Harvest Gala',
        theme: 'AUTUMN',
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        isActive: true,
        rewards: [],
      },
    });

    // Add progress for users
    await SeasonalEventService.addProgress(user1.id, event.id, 250); // Tier 2, currency 250
    await SeasonalEventService.addProgress(user2.id, event.id, 120); // Tier 1, currency 120
    await SeasonalEventService.addProgress(user3.id, event.id, 50);  // Tier 0, currency 50

    // Fetch leaderboard
    const leaderboard = await SeasonalEventService.getLeaderboard(event.id);
    expect(leaderboard.length).toBe(3);
    expect(leaderboard[0].userId).toBe(user1.id);
    expect(leaderboard[1].userId).toBe(user2.id);
    expect(leaderboard[2].userId).toBe(user3.id);

    // Archive leaderboard and award podium bonuses
    const archiveResult = await SeasonalEventService.archiveLeaderboard(event.id);
    expect(archiveResult.totalParticipants).toBe(3);
    expect(archiveResult.podiumAwards.length).toBe(3);
    expect(archiveResult.podiumAwards[0].bonusCoins).toBe(500);
    expect(archiveResult.podiumAwards[1].bonusCoins).toBe(300);
    expect(archiveResult.podiumAwards[2].bonusCoins).toBe(150);

    // Verify user coin updates
    const updatedUser1 = await prisma.user.findUnique({ where: { id: user1.id } });
    expect(updatedUser1?.havenCoins).toBe(600); // 100 + 500

    // Cleanup
    await prisma.transactionLog.deleteMany({ where: { receiverId: { in: [user1.id, user2.id, user3.id] } } });
    await prisma.seasonalProgress.deleteMany({ where: { eventId: event.id } });
    await prisma.seasonalEvent.delete({ where: { id: event.id } });
    await prisma.avatar.deleteMany({ where: { userId: { in: [user1.id, user2.id, user3.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id, user3.id] } } });
  });
});
