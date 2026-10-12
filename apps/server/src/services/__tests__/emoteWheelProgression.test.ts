import { EmoteProgressionService, DEFAULT_EMOTE_WHEEL } from '../EmoteProgressionService';
import { prisma } from '../../prisma';
import { redisClient, connectRedis } from '../../redis';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 38: Emote Progression Wheel Customization & Animation Descriptors', () => {
  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  it('exposes default unlocked emotes with animation descriptors', async () => {
    const user = await createTestUser();

    const emotes = await EmoteProgressionService.getPlayerEmotes(user.id);
    expect(emotes.length).toBeGreaterThanOrEqual(8);

    const wave = emotes.find((e) => e.id === 'wave');
    expect(wave?.unlocked).toBe(true);
    expect(wave?.animation.durationMs).toBe(1200);

    const backflip = emotes.find((e) => e.id === 'backflip');
    expect(backflip?.unlocked).toBe(false);

    // Default wheel returns base defaults
    const wheel = await EmoteProgressionService.getEmoteWheel(user.id);
    expect(wheel).toEqual(DEFAULT_EMOTE_WHEEL);

    // Cleanup
    await prisma.avatar.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('validates emote unlocks, customizes 8-slot wheel, and returns animation descriptors on trigger', async () => {
    const user = await createTestUser({ havenCoins: 50 });

    // 1. Equipping locked backflip fails
    await expect(
      EmoteProgressionService.setEmoteWheel(user.id, ['wave', 'jump', 'backflip'])
    ).rejects.toThrow('Cannot equip locked emote "Acrobatic Backflip"');

    // 2. Triggering locked emote fails
    await expect(
      EmoteProgressionService.validateEmoteTrigger(user.id, 'backflip')
    ).rejects.toThrow('is locked');

    // 3. Meet unlock criteria: catch 5 fish
    for (let i = 0; i < 5; i++) {
      await prisma.fishCatch.create({
        data: {
          userId: user.id,
          species: 'Haven Perch',
          weightLbs: 3.5,
          coinsEarned: 15,
        },
      });
    }

    // Now backflip is unlocked
    const updatedEmotes = await EmoteProgressionService.getPlayerEmotes(user.id);
    const updatedBackflip = updatedEmotes.find((e) => e.id === 'backflip');
    expect(updatedBackflip?.unlocked).toBe(true);

    // 4. Equip customized wheel including backflip
    const newWheel = ['wave', 'jump', 'dance', 'backflip', 'laugh'];
    const equipped = await EmoteProgressionService.setEmoteWheel(user.id, newWheel);
    expect(equipped).toEqual(newWheel);

    const retrievedWheel = await EmoteProgressionService.getEmoteWheel(user.id);
    expect(retrievedWheel).toEqual(newWheel);

    // 5. Trigger valid unlocked emote and receive animation descriptors
    const triggerData = await EmoteProgressionService.validateEmoteTrigger(user.id, 'backflip');
    expect(triggerData.emoteId).toBe('backflip');
    expect(triggerData.animation.particleEffect).toBe('acrobatic_sparks');
    expect(triggerData.animation.durationMs).toBe(1000);

    // Cleanup
    if (redisClient.isOpen) {
      await redisClient.del(`user:emote_wheel:${user.id}`);
    }
    await prisma.fishCatch.deleteMany({ where: { userId: user.id } });
    await prisma.avatar.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
