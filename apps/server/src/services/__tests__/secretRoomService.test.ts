import { SecretRoomService } from '../SecretRoomService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 21: SecretRoomService Discovery Mechanic', () => {
  it('exposes secret chambers with clues and positive bounties', () => {
    const chambers = SecretRoomService.getChambers();
    expect(chambers.length).toBe(4);
    for (const c of chambers) {
      expect(c.id).toBeDefined();
      expect(c.name).toBeDefined();
      expect(c.triggerPhrase).toBeDefined();
      expect(c.clue).toBeDefined();
      expect(c.bountyCoins).toBeGreaterThan(0);
    }
  });

  it('awards first-time bounty, logs event, unlocks achievement, and deduplicates repeat triggers', async () => {
    const user = await createTestUser({ havenCoins: 50 });

    // 1. Spoken message triggers secret chamber
    const firstResult = await SecretRoomService.checkSecretTrigger(
      user.id,
      'room-park',
      'Please speak abracadabra to open the path!'
    );

    expect(firstResult.triggered).toBe(true);
    expect(firstResult.secretRoomId).toBe('room_secret_observatory');
    expect(firstResult.easterEggName).toBe('The Forgotten Observatory');
    expect(firstResult.isFirstDiscovery).toBe(true);
    expect(firstResult.bountyCoins).toBe(100);

    // Verify user received bounty coins
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.havenCoins).toBe(150); // 50 + 100

    // Verify achievement unlocked
    const achievement = await prisma.achievement.findFirst({
      where: { userId: user.id, stamp: 'Secret Explorer' },
    });
    expect(achievement).not.toBeNull();

    // 2. User repeats trigger: triggers room entry, but NO duplicate bounty coins awarded
    const secondResult = await SecretRoomService.checkSecretTrigger(
      user.id,
      'room-park',
      'Saying abracadabra again'
    );
    expect(secondResult.triggered).toBe(true);
    expect(secondResult.secretRoomId).toBe('room_secret_observatory');
    expect(secondResult.isFirstDiscovery).toBe(false);
    expect(secondResult.bountyCoins).toBe(0);

    const noExtraCoins = await prisma.user.findUnique({ where: { id: user.id } });
    expect(noExtraCoins?.havenCoins).toBe(150);

    // 3. User discoveries report
    const discoveries = await SecretRoomService.getUserDiscoveries(user.id);
    expect(discoveries).toContain('room_secret_observatory');

    // Cleanup
    await prisma.transactionLog.deleteMany({ where: { receiverId: user.id } });
    await prisma.gameEvent.deleteMany({ where: { userId: user.id } });
    await prisma.achievement.deleteMany({ where: { userId: user.id } });
    await prisma.avatar.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
