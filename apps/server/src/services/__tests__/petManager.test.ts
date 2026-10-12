import { PetManager, calculatePetLoyalty } from '../PetManager';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('PetManager Loyalty Calculation', () => {
  it('correctly maps happiness and hunger composite score to loyalty levels', () => {
    const soulmate = calculatePetLoyalty(100, 100);
    expect(soulmate.level).toBe('SOULMATE');
    expect(soulmate.score).toBe(100);
    expect(soulmate.perks).toContain('Exclusive golden aura');

    const bestFriend = calculatePetLoyalty(80, 75);
    expect(bestFriend.level).toBe('BEST_FRIEND');
    expect(bestFriend.perks).toContain('+5% XP bonus');

    const devoted = calculatePetLoyalty(60, 50);
    expect(devoted.level).toBe('DEVOTED');

    const friend = calculatePetLoyalty(30, 40);
    expect(friend.level).toBe('FRIEND');

    const acquaintance = calculatePetLoyalty(10, 10);
    expect(acquaintance.level).toBe('ACQUAINTANCE');
    expect(acquaintance.perks).toContain('Needs food and attention');
  });
});

describe('PetManager Autonomous State & Real DB Decay', () => {
  it('adopts, feeds, decays individually, and executes bulk decay against database', async () => {
    const user = await createTestUser();

    // Adopt pet
    const pet = await PetManager.adoptPet(user.id, 'DOG', 'Barkley');
    expect(pet.id).toBeDefined();
    expect(pet.name).toBe('Barkley');
    expect(pet.happiness).toBe(100);
    expect(pet.hunger).toBe(100);

    // Initial loyalty check
    const loyalty = await PetManager.getPetLoyalty(pet.id);
    expect(loyalty.level).toBe('SOULMATE');

    // Individual decay
    const decayed = await PetManager.decayPet(pet.id, 25, 20);
    expect(decayed.hunger).toBe(75);
    expect(decayed.happiness).toBe(80);

    // Feed pet restores hunger and happiness up to 100
    const fed = await PetManager.feedPet(user.id, pet.id);
    expect(fed.hunger).toBe(100);
    expect(fed.happiness).toBe(95);

    // Bulk decay across database
    const decayedCount = await PetManager.decayAllPets();
    expect(decayedCount).toBeGreaterThanOrEqual(1);

    const afterBulk = await prisma.pet.findUnique({ where: { id: pet.id } });
    expect(afterBulk?.hunger).toBe(95);
    expect(afterBulk?.happiness).toBe(92);

    // Decay clamp to zero
    const drained = await PetManager.decayPet(pet.id, 200, 200);
    expect(drained.hunger).toBe(0);
    expect(drained.happiness).toBe(0);

    const lowLoyalty = await PetManager.getPetLoyalty(pet.id);
    expect(lowLoyalty.level).toBe('ACQUAINTANCE');

    // Cleanup
    await prisma.pet.delete({ where: { id: pet.id } });
    await prisma.avatar.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
