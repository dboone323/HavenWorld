import { ClubService } from '../ClubService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';

describe('ClubService Progression & Management', () => {
  beforeAll(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('Club creation and profanity filtering', () => {
    it('creates club, charges 500 coins, provisions dedicated room, and sanitizes profane names and mottos', async () => {
      const owner = await createTestUser({ havenCoins: 1000 });

      // Profane name and motto with bad words (e.g. 'shit', 'damn')
      const profaneName = 'Bad shit Guild';
      const profaneMotto = 'No damn rules here';

      const club = await ClubService.createClub(owner.id, profaneName, profaneMotto, 'BADG');
      expect(club).toBeDefined();

      // Verify name and motto were moderated with asterisks
      expect(club.name).toContain('***');
      expect(club.name).not.toContain('shit');
      expect(club.motto).toContain('****');
      expect(club.motto).not.toContain('damn');

      // Verify 500 HavenCoins deducted
      const dbOwner = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(dbOwner?.havenCoins).toBe(500);

      // Verify dedicated clubhouse room was created
      expect(club.roomId).not.toBeNull();
      const clubRoom = await prisma.room.findUnique({ where: { id: club.roomId! } });
      expect(clubRoom).not.toBeNull();
      expect(clubRoom?.theme).toBe('clubhouse');
      expect(clubRoom?.ownerId).toBe(owner.id);

      // Verify owner is assigned OWNER role
      const ownerMember = await prisma.clubMember.findUnique({ where: { userId: owner.id } });
      expect(ownerMember?.clubId).toBe(club.id);
      expect(ownerMember?.role).toBe('OWNER');

      // Test updating MOTD with profanity
      const updated = await ClubService.setClubMotd(owner.id, club.id, 'Another shit announcement');
      expect(updated.motto).toContain('****');
      expect(updated.motto).not.toContain('shit');
    });

    it('rejects club creation when coins are insufficient or name is too short', async () => {
      const poorUser = await createTestUser({ havenCoins: 200 });

      // Insufficient coins (< 500)
      await expect(
        ClubService.createClub(poorUser.id, 'Elite Adventurers', 'Motto')
      ).rejects.toThrow('Insufficient HavenCoins (500 required)');

      // Name too short (< 3 chars)
      const richUser = await createTestUser({ havenCoins: 1000 });
      await expect(
        ClubService.createClub(richUser.id, 'AB', 'Motto')
      ).rejects.toThrow('Club name must be at least 3 characters');
    });
  });

  describe('Member role transitions and member cap enforcement', () => {
    it('manages transitions between Member, Officer, and Leader/Owner restrictions', async () => {
      const owner = await createTestUser({ havenCoins: 1000 });
      const member1 = await createTestUser({ havenCoins: 500 });
      const member2 = await createTestUser({ havenCoins: 500 });
      const outsider = await createTestUser({ havenCoins: 500 });

      const club = await ClubService.createClub(owner.id, 'Role Test Club', 'Motto');

      // Join members
      await ClubService.joinClub(member1.id, club.id);
      await ClubService.joinClub(member2.id, club.id);

      // 1. Promote member1 to OFFICER
      const promoted = await ClubService.updateMemberRole(owner.id, club.id, member1.id, 'OFFICER');
      expect(promoted.role).toBe('OFFICER');

      // 2. Demote member1 back to MEMBER
      const demoted = await ClubService.updateMemberRole(owner.id, club.id, member1.id, 'MEMBER');
      expect(demoted.role).toBe('MEMBER');

      // 3. Non-owner cannot update roles
      await expect(
        ClubService.updateMemberRole(member2.id, club.id, member1.id, 'OFFICER')
      ).rejects.toThrow('Only the club Owner can modify member roles');

      // 4. Cannot update role of outsider
      await expect(
        ClubService.updateMemberRole(owner.id, club.id, outsider.id, 'OFFICER')
      ).rejects.toThrow('Target user is not a member of this club');

      // 5. Cannot assign OWNER role via updateMemberRole
      await expect(
        ClubService.updateMemberRole(owner.id, club.id, member1.id, 'OWNER' as any)
      ).rejects.toThrow('Cannot assign OWNER role via role update');

      // 6. Cannot demote the club Owner
      await expect(
        ClubService.updateMemberRole(owner.id, club.id, owner.id, 'MEMBER')
      ).rejects.toThrow('Cannot change the role of the club Owner');
    });

    it('enforces the 50-member cap on join and invitation', async () => {
      const owner = await createTestUser({ havenCoins: 1000 });
      const club = await ClubService.createClub(owner.id, 'Full Capacity Club', 'Motto');

      // Bulk create 49 members to reach cap of 50 (1 owner + 49 members = 50)
      const additionalUsers = [];
      for (let i = 0; i < 49; i++) {
        const u = await createTestUser({ havenCoins: 0 });
        additionalUsers.push(u);
      }

      await prisma.clubMember.createMany({
        data: additionalUsers.map((u) => ({
          clubId: club.id,
          userId: u.id,
          role: 'MEMBER' as const,
        })),
      });

      const count = await prisma.clubMember.count({ where: { clubId: club.id } });
      expect(count).toBe(50);

      // 51st user attempts to join -> must fail
      const applicant = await createTestUser({ havenCoins: 100 });
      await expect(ClubService.joinClub(applicant.id, club.id)).rejects.toThrow(
        'Club is full (max 50 members)'
      );

      // Owner attempts to invite 51st user -> must fail
      await expect(
        ClubService.addMember(owner.id, club.id, applicant.id)
      ).rejects.toThrow('Club is full (max 50 members)');
    });
  });

  describe('Club disbanding and cascade deletion', () => {
    it('allows owner to disband club, cascading deletion to all memberships and clubhouse room', async () => {
      const owner = await createTestUser({ havenCoins: 1000 });
      const member = await createTestUser({ havenCoins: 100 });

      const club = await ClubService.createClub(owner.id, 'Disbandable Club', 'Will be deleted');
      await ClubService.joinClub(member.id, club.id);

      const roomId = club.roomId;
      expect(roomId).toBeTruthy();

      // Non-owner cannot disband
      await expect(ClubService.disbandClub(member.id, club.id)).rejects.toThrow(
        'Only the club Owner can disband the club'
      );

      // Owner disbands
      const disbanded = await ClubService.disbandClub(owner.id, club.id);
      expect(disbanded.id).toBe(club.id);

      // Verify club is deleted
      const checkClub = await prisma.club.findUnique({ where: { id: club.id } });
      expect(checkClub).toBeNull();

      // Verify memberships are cascade deleted
      const members = await prisma.clubMember.findMany({ where: { clubId: club.id } });
      expect(members).toHaveLength(0);

      const ownerMember = await prisma.clubMember.findUnique({ where: { userId: owner.id } });
      expect(ownerMember).toBeNull();

      const normalMember = await prisma.clubMember.findUnique({ where: { userId: member.id } });
      expect(normalMember).toBeNull();

      // Verify clubhouse room is cleaned up
      const checkRoom = await prisma.room.findUnique({ where: { id: roomId! } });
      expect(checkRoom).toBeNull();

      // Users are free to create or join a new club
      const newOwner = await createTestUser({ havenCoins: 1000 });
      const newClub = await ClubService.createClub(newOwner.id, 'New Haven Guild');
      const reJoined = await ClubService.joinClub(member.id, newClub.id);
      expect(reJoined.clubId).toBe(newClub.id);
    });
  });
});
