import { ClubService } from '../ClubService';
import { prisma } from '../../prisma';
import { redisClient } from '../../redis';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 31: Club Leveling Perks, Roles & Treasury Management', () => {
  it('correctly calculates treasury tiers and progressive perks', () => {
    const tier1 = ClubService.calculateTreasuryTier(500);
    expect(tier1.level).toBe(1);
    expect(tier1.perks).toEqual(['Clubhouse HQ Access']);
    expect(tier1.nextLevelThreshold).toBe(1000);

    const tier2 = ClubService.calculateTreasuryTier(1500);
    expect(tier2.level).toBe(2);
    expect(tier2.perks).toContain('+10% Fishing Coins');
    expect(tier2.nextLevelThreshold).toBe(5000);

    const tier3 = ClubService.calculateTreasuryTier(8000);
    expect(tier3.level).toBe(3);
    expect(tier3.perks).toContain('+15% Workshop Crafting Speed');
    expect(tier3.nextLevelThreshold).toBe(20000);

    const tier4 = ClubService.calculateTreasuryTier(25000);
    expect(tier4.level).toBe(4);
    expect(tier4.perks).toContain('Exclusive Grand Trophy Room & Chandelier');
    expect(tier4.nextLevelThreshold).toBeNull();
  });

  it('manages club lifecycle, treasury deposit, tier upgrades, role progression, and MOTD', async () => {
    // 1. Create real users with real HavenCoins
    const owner = await createTestUser({ havenCoins: 2000 });
    const member = await createTestUser({ havenCoins: 3000 });
    const outsider = await createTestUser({ havenCoins: 1000 });

    const clubName = `Guild_${Date.now().toString(36).slice(-6)}`;
    const club = await ClubService.createClub(owner.id, clubName, 'Original Motto', 'GLD');
    expect(club).toBeDefined();
    expect(club.name).toBe(clubName);

    // 2. Member joins club
    const membership = await ClubService.joinClub(member.id, club.id);
    expect(membership.role).toBe('MEMBER');

    // 3. Member deposits into treasury
    const depositResult = await ClubService.depositTreasury(member.id, club.id, 1200);
    expect(depositResult.amount).toBe(1200);
    expect(depositResult.balance).toBe(1200);
    expect(depositResult.level).toBe(2);
    expect(depositResult.perks).toContain('+10% Fishing Coins');
    expect(depositResult.userRemainingCoins).toBe(1800); // 3000 - 1200

    // Verify user balance in DB
    const dbMemberUser = await prisma.user.findUnique({ where: { id: member.id } });
    expect(dbMemberUser?.havenCoins).toBe(1800);

    // Verify transaction log
    const txLog = await prisma.transactionLog.findFirst({
      where: { senderId: member.id, receiverId: owner.id, type: 'CLUB_TREASURY_DEPOSIT' },
    });
    expect(txLog).not.toBeNull();
    expect(txLog?.amount).toBe(1200);

    // 4. Query treasury info
    const treasury = await ClubService.getTreasury(club.id);
    expect(treasury.balance).toBe(1200);
    expect(treasury.level).toBe(2);

    // 5. Outsider deposit fails
    await expect(ClubService.depositTreasury(outsider.id, club.id, 100)).rejects.toThrow(
      'You are not a member of this club'
    );

    // 6. Role management: Owner promotes member to OFFICER
    const promoted = await ClubService.updateMemberRole(owner.id, club.id, member.id, 'OFFICER');
    expect(promoted.role).toBe('OFFICER');

    // Non-owner cannot promote/demote
    await expect(
      ClubService.updateMemberRole(outsider.id, club.id, member.id, 'MEMBER')
    ).rejects.toThrow('Only the club Owner can modify member roles');

    // Owner demotes member back to MEMBER
    const demoted = await ClubService.updateMemberRole(owner.id, club.id, member.id, 'MEMBER');
    expect(demoted.role).toBe('MEMBER');

    // Cannot assign OWNER role
    await expect(
      ClubService.updateMemberRole(owner.id, club.id, member.id, 'OWNER')
    ).rejects.toThrow('Cannot assign OWNER role via role update');

    // 7. MOTD management
    const updatedClub = await ClubService.setClubMotd(owner.id, club.id, 'New Champions Wanted!');
    expect(updatedClub.motto).toBe('New Champions Wanted!');

    // Normal member cannot update MOTD
    await expect(
      ClubService.setClubMotd(member.id, club.id, 'Hacked MOTD')
    ).rejects.toThrow('Only club Owner or Officers can update the club MOTD');

    // Cleanup
    if (redisClient.isOpen) {
      await redisClient.del(`club:treasury:${club.id}`);
      await redisClient.del(`club:chat:${club.id}`);
    }
    await prisma.transactionLog.deleteMany({ where: { receiverId: owner.id } });
    await prisma.clubMember.deleteMany({ where: { clubId: club.id } });
    await prisma.club.delete({ where: { id: club.id } });
    if (club.roomId) {
      await prisma.room.delete({ where: { id: club.roomId } });
    }
    await prisma.avatar.deleteMany({ where: { userId: { in: [owner.id, member.id, outsider.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id, outsider.id] } } });
  });
});
