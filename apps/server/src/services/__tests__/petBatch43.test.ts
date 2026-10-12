import { prisma } from '../../prisma';
import { PetManager, calculatePetLoyalty, PET_TRICKS } from '../PetManager';

describe('Batch 43: Pet Affection Progression, Trick Unlocks & Satiety Decay', () => {
  let testUser: any;
  let testPet: any;

  beforeAll(async () => {
    testUser = await prisma.user.create({
      data: {
        username: `petowner_${Date.now()}`,
        email: `petowner_${Date.now()}@example.com`,
        passwordHash: 'hash',
      },
    });

    testPet = await prisma.pet.create({
      data: {
        ownerId: testUser.id,
        name: 'Mochi',
        petType: 'DOG',
        happiness: 80,
        hunger: 80,
      },
    });
  });

  afterAll(async () => {
    if (testPet?.id) {
      await prisma.pet.delete({ where: { id: testPet.id } }).catch(() => {});
    }
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  it('correctly calculates loyalty tiers based on composite happiness and hunger', () => {
    expect(calculatePetLoyalty(95, 90).level).toBe('SOULMATE');
    expect(calculatePetLoyalty(80, 75).level).toBe('BEST_FRIEND');
    expect(calculatePetLoyalty(60, 50).level).toBe('DEVOTED');
    expect(calculatePetLoyalty(30, 20).level).toBe('FRIEND');
    expect(calculatePetLoyalty(10, 10).level).toBe('ACQUAINTANCE');
  });

  it('performs unlocked trick when pet loyalty and energy are sufficient', async () => {
    // Current loyalty for 80/80 is BEST_FRIEND (score: 80).
    // Trick SIT requires ACQUAINTANCE, SPIN requires FRIEND, BACKFLIP requires BEST_FRIEND.
    const result = await PetManager.performTrick(testUser.id, testPet.id, 'BACKFLIP');
    expect(result.success).toBe(true);
    expect(result.trick).toBe('BACKFLIP');
    expect(result.happinessGain).toBe(PET_TRICKS.BACKFLIP.happinessReward);

    const refreshed = await prisma.pet.findUnique({ where: { id: testPet.id } });
    expect(refreshed?.happiness).toBeGreaterThanOrEqual(80);
  });

  it('blocks tricks requiring higher loyalty tiers than currently earned', async () => {
    // Set pet to ACQUAINTANCE
    await prisma.pet.update({
      where: { id: testPet.id },
      data: { happiness: 20, hunger: 20 },
    });

    // DANCE requires SOULMATE
    await expect(
      PetManager.performTrick(testUser.id, testPet.id, 'DANCE')
    ).rejects.toThrow(/Requires loyalty SOULMATE/i);
  });

  it('grooms pet and restores happiness', async () => {
    const groomResult = await PetManager.groomPet(testUser.id, testPet.id);
    expect(groomResult.cleaned).toBe(true);
    expect(groomResult.happiness).toBe(40); // 20 + 20
  });

  it('feeds specialty treat with customized satiety bonuses', async () => {
    const feedResult = await PetManager.feedPetTreat(testUser.id, testPet.id, 'GOLDEN_APPLE');
    expect(feedResult.hunger).toBe(70); // 20 + 50
    expect(feedResult.happiness).toBe(80); // 40 + 40
    expect(feedResult.treat).toBe('GOLDEN_APPLE');
  });
});
