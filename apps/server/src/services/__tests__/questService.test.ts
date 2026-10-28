import { QuestService } from '../QuestService';
import { DailyLoginStreakService } from '../DailyLoginStreakService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';
import { getDailyQuests } from '@havenworld/shared';

describe('QuestService & Daily Streak Economy', () => {
  beforeAll(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('Daily streak increments and claim limits', () => {
    it('awards streak rewards on first login and prevents double-claiming within the same 24h UTC period', async () => {
      const user = await createTestUser({ havenCoins: 0, havenGems: 0 });

      // Day 1 Login
      const day1 = new Date('2026-10-25T08:00:00Z');
      const claim1 = await DailyLoginStreakService.recordLogin(user.id, day1);

      expect(claim1.currentStreak).toBe(1);
      expect(claim1.longestStreak).toBe(1);
      expect(claim1.rewardCoins).toBe(50);
      expect(claim1.rewardGems).toBe(0);
      expect(claim1.alreadyClaimedToday).toBe(false);

      // Verify DB balance
      const userAfterDay1 = await prisma.user.findUnique({ where: { id: user.id } });
      expect(userAfterDay1?.havenCoins).toBe(50);

      // Same-day retry: must be rejected with 0 rewards
      const sameDayLater = new Date('2026-10-25T20:30:00Z');
      const claimRetry = await DailyLoginStreakService.recordLogin(user.id, sameDayLater);

      expect(claimRetry.alreadyClaimedToday).toBe(true);
      expect(claimRetry.rewardCoins).toBe(0);
      expect(claimRetry.rewardGems).toBe(0);
      expect(claimRetry.currentStreak).toBe(1);

      // User balance unchanged
      const userAfterRetry = await prisma.user.findUnique({ where: { id: user.id } });
      expect(userAfterRetry?.havenCoins).toBe(50);

      // Consecutive Day 2 Login
      const day2 = new Date('2026-10-26T09:00:00Z');
      const claim2 = await DailyLoginStreakService.recordLogin(user.id, day2);

      expect(claim2.currentStreak).toBe(2);
      expect(claim2.longestStreak).toBe(2);
      expect(claim2.rewardCoins).toBe(75);
      expect(claim2.alreadyClaimedToday).toBe(false);

      const userAfterDay2 = await prisma.user.findUnique({ where: { id: user.id } });
      expect(userAfterDay2?.havenCoins).toBe(125); // 50 + 75

      // Broken streak after 3-day absence
      const day5 = new Date('2026-10-29T11:00:00Z');
      const claim5 = await DailyLoginStreakService.recordLogin(user.id, day5);

      expect(claim5.currentStreak).toBe(1); // Reset
      expect(claim5.longestStreak).toBe(2); // Preserved
      expect(claim5.rewardCoins).toBe(50);
    });
  });

  describe('Quest progress updates and atomic reward disbursement', () => {
    it('initializes 3 quests, updates progress incrementally, and awards coins/gems atomically on completion', async () => {
      const user = await createTestUser({ havenCoins: 100, havenGems: 10 });
      const testDate = new Date('2026-10-27T12:00:00Z');

      // 1. Fetch user daily quests
      const quests = await QuestService.getUserDailyQuests(user.id, testDate);
      expect(quests).toHaveLength(3);
      expect(quests.every((q) => q.progress === 0 && !q.completed)).toBe(true);

      const targetQuest = quests[0];
      const templates = getDailyQuests(testDate);
      const targetTemplate = templates.find((t) => t.id === targetQuest.questId);
      expect(targetTemplate).toBeDefined();

      const actionType = targetTemplate!.actionType;
      const initialCoins = 100;
      const initialGems = 10;

      // 2. Increment partial progress (1 unit)
      await QuestService.incrementProgress(user.id, actionType, 1, testDate);

      const questsAfterStep1 = await QuestService.getUserDailyQuests(user.id, testDate);
      const step1Quest = questsAfterStep1.find((q) => q.questId === targetQuest.questId);
      expect(step1Quest?.progress).toBe(1);
      expect(step1Quest?.completed).toBe(targetQuest.goal <= 1);

      // Verify balance not disbursed if goal > 1
      if (targetQuest.goal > 1) {
        const intermediateUser = await prisma.user.findUnique({ where: { id: user.id } });
        expect(intermediateUser?.havenCoins).toBe(initialCoins);
      }

      // 3. Complete the quest
      await QuestService.incrementProgress(user.id, actionType, targetQuest.goal, testDate);

      const questsAfterComplete = await QuestService.getUserDailyQuests(user.id, testDate);
      const completedQuest = questsAfterComplete.find((q) => q.questId === targetQuest.questId);
      expect(completedQuest?.completed).toBe(true);
      expect(completedQuest?.progress).toBe(targetQuest.goal);

      // Verify user reward disbursement
      const userAfterComplete = await prisma.user.findUnique({ where: { id: user.id } });
      expect(userAfterComplete?.havenCoins).toBe(initialCoins + targetQuest.rewardCoins);
      expect(userAfterComplete?.havenGems).toBe(initialGems + targetQuest.rewardGems);

      // 4. Atomicity check: extra increments on completed quest must NOT disburse duplicate rewards
      await QuestService.incrementProgress(user.id, actionType, 5, testDate);

      const userAfterExcess = await prisma.user.findUnique({ where: { id: user.id } });
      expect(userAfterExcess?.havenCoins).toBe(initialCoins + targetQuest.rewardCoins);
      expect(userAfterExcess?.havenGems).toBe(initialGems + targetQuest.rewardGems);
    });
  });

  describe('Expired quest resets at 00:00 UTC', () => {
    it('provisions new quests for subsequent UTC days while archiving previous progress', async () => {
      const user = await createTestUser({ havenCoins: 50, havenGems: 5 });

      const day1 = new Date('2026-10-27T14:00:00Z');
      const day1StartUtc = new Date(Date.UTC(2026, 9, 27));

      const day1Quests = await QuestService.getUserDailyQuests(user.id, day1);
      expect(day1Quests).toHaveLength(3);

      // Advance progress on day 1
      const day1Template = getDailyQuests(day1)[0];
      await QuestService.incrementProgress(user.id, day1Template.actionType, day1Template.goal, day1);

      const day1DbRecords = await prisma.dailyQuestProgress.findMany({
        where: { userId: user.id, questDate: day1StartUtc },
      });
      const day1CompletedRecord = day1DbRecords.find((r) => r.questId === day1Template.id);
      expect(day1CompletedRecord?.completed).toBe(true);

      // Next day past 00:00 UTC
      const day2 = new Date('2026-10-28T01:30:00Z');
      const day2StartUtc = new Date(Date.UTC(2026, 9, 28));

      // Fetching quests on Day 2 provisions new quest records
      const day2Quests = await QuestService.getUserDailyQuests(user.id, day2);
      expect(day2Quests).toHaveLength(3);
      expect(day2Quests.every((q) => q.progress === 0 && !q.completed)).toBe(true);

      // Day 1 records remain preserved in the database
      const archivedDay1Records = await prisma.dailyQuestProgress.findMany({
        where: { userId: user.id, questDate: day1StartUtc },
      });
      expect(archivedDay1Records).toHaveLength(3);
      expect(archivedDay1Records.find((r) => r.questId === day1Template.id)?.completed).toBe(true);

      // Day 2 progress updates do not affect Day 1 records
      const day2Template = getDailyQuests(day2)[0];
      await QuestService.incrementProgress(user.id, day2Template.actionType, 1, day2);

      const day2DbRecord = await prisma.dailyQuestProgress.findUnique({
        where: {
          userId_questId_questDate: {
            userId: user.id,
            questId: day2Template.id,
            questDate: day2StartUtc,
          },
        },
      });
      expect(day2DbRecord?.progress).toBe(1);

      // Day 1 completed record unchanged
      const day1Check = await prisma.dailyQuestProgress.findUnique({
        where: {
          userId_questId_questDate: {
            userId: user.id,
            questId: day1Template.id,
            questDate: day1StartUtc,
          },
        },
      });
      expect(day1Check?.completed).toBe(true);
    });
  });
});
