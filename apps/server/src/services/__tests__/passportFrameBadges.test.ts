import { AchievementService } from '../AchievementService';
import { prisma } from '../../prisma';
import { redisClient, connectRedis } from '../../redis';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 37: Player Passport Stamp Milestones, Frames & Badges', () => {
  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  describe('Milestone Tier & Completion Calculations', () => {
    it('calculates milestone tiers, completion percentages, and next milestone targets', () => {
      const bronze = AchievementService.calculatePassportMilestone(2);
      expect(bronze.tier).toBe('BRONZE');
      expect(bronze.badge).toBe('Haven Explorer');
      expect(bronze.completionPercentage).toBe(10);
      expect(bronze.nextMilestoneCount).toBe(5);

      const silver = AchievementService.calculatePassportMilestone(8);
      expect(silver.tier).toBe('SILVER');
      expect(silver.badge).toBe('Haven Pioneer');
      expect(silver.completionPercentage).toBe(40);
      expect(silver.nextMilestoneCount).toBe(10);

      const gold = AchievementService.calculatePassportMilestone(14);
      expect(gold.tier).toBe('GOLD');
      expect(gold.badge).toBe('Haven Champion');
      expect(gold.completionPercentage).toBe(70);
      expect(gold.nextMilestoneCount).toBe(15);

      const platinum = AchievementService.calculatePassportMilestone(17);
      expect(platinum.tier).toBe('PLATINUM');
      expect(platinum.badge).toBe('Haven Luminary');
      expect(platinum.completionPercentage).toBe(85);
      expect(platinum.nextMilestoneCount).toBe(20);

      const diamond = AchievementService.calculatePassportMilestone(20);
      expect(diamond.tier).toBe('DIAMOND');
      expect(diamond.badge).toBe('Legend of Haven');
      expect(diamond.completionPercentage).toBe(100);
      expect(diamond.nextMilestoneCount).toBeNull();
    });
  });

  describe('Real Database Frame Customization & Unlocks', () => {
    it('enforces frame unlock rules and persists customization in PostgreSQL and Redis', async () => {
      const user = await createTestUser();

      // 1. Default frame is always allowed
      const defaultFrame = await AchievementService.setPassportFrame(user.id, 'default');
      expect(defaultFrame.frameId).toBe('default');

      // 2. VIP frame requires VIP membership
      await expect(
        AchievementService.setPassportFrame(user.id, 'golden_vip')
      ).rejects.toThrow('Golden VIP frame requires active VIP membership');

      // Grant VIP status
      await prisma.user.update({
        where: { id: user.id },
        data: { isVIP: true },
      });

      const vipFrame = await AchievementService.setPassportFrame(user.id, 'golden_vip');
      expect(vipFrame.frameId).toBe('golden_vip');

      // 3. Secret Explorer frame requires stamp
      await expect(
        AchievementService.setPassportFrame(user.id, 'secret_explorer')
      ).rejects.toThrow('Requires Secret Explorer achievement');

      // Award stamp
      await prisma.achievement.create({
        data: {
          userId: user.id,
          stamp: 'Secret Explorer',
        },
      });

      const explorerFrame = await AchievementService.setPassportFrame(user.id, 'secret_explorer');
      expect(explorerFrame.frameId).toBe('secret_explorer');

      // 4. Featured profile badge
      const badgeRes = await AchievementService.setFeaturedBadge(user.id, 'Grand Cartographer');
      expect(badgeRes.featuredBadge).toBe('Grand Cartographer');

      // 5. Query passport data
      const passport = await AchievementService.getPassportData(user.id);
      expect(passport).not.toBeNull();
      expect(passport?.frameId).toBe('secret_explorer');
      expect(passport?.featuredBadge).toBe('Grand Cartographer');
      expect(passport?.stamps.length).toBe(1);
      expect(passport?.milestone.tier).toBe('BRONZE');

      // Cleanup
      if (redisClient.isOpen) {
        await redisClient.del(`user:featured_badge:${user.id}`);
      }
      await prisma.passportFrame.deleteMany({ where: { userId: user.id } });
      await prisma.achievement.deleteMany({ where: { userId: user.id } });
      await prisma.avatar.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });
});
