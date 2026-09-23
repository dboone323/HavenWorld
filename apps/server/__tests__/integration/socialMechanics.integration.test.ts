import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';
import { ShopService } from '../../src/services/ShopService';
import { ClubService } from '../../src/services/ClubService';

describe('Track 5 Integration: Social Mechanics, Trust & Safety', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('5.3: Friend Presence & Location Follow', () => {
    it('should return location information only for accepted friends', async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();
      const stranger = await createTestUser();

      // Make user1 and user2 accepted friends
      await prisma.friend.create({
        data: {
          requesterId: user1.id,
          addresseeId: user2.id,
          status: 'ACCEPTED',
        },
      });

      const token1 = generateTestToken(user1.id);
      const strangerToken = generateTestToken(stranger.id);

      // Friend query
      const friendRes = await request(app)
        .get(`/api/friends/${user2.id}/location`)
        .set('Authorization', `Bearer ${token1}`);

      expect(friendRes.status).toBe(200);
      expect(friendRes.body).toHaveProperty('isOnline');
      expect(friendRes.body).toHaveProperty('canFollow');

      // Stranger query -> 403
      const strangerRes = await request(app)
        .get(`/api/friends/${user2.id}/location`)
        .set('Authorization', `Bearer ${strangerToken}`);

      expect(strangerRes.status).toBe(403);
    });
  });

  describe('5.4: Ignore & Block Lists', () => {
    it('should block a user, list them in blocked list, and allow unblocking', async () => {
      const user = await createTestUser();
      const annoyingUser = await createTestUser();
      const token = generateTestToken(user.id);

      // 1. Block annoyingUser
      const blockRes = await request(app)
        .post('/api/friends/block')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: annoyingUser.id });

      expect(blockRes.status).toBe(201);
      expect(blockRes.body.success).toBe(true);

      // 2. Check blocked list
      const listRes = await request(app)
        .get('/api/friends/blocked')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.some((b: any) => b.id === annoyingUser.id)).toBe(true);

      // 3. Unblock
      const unblockRes = await request(app)
        .post('/api/friends/unblock')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: annoyingUser.id });

      expect(unblockRes.status).toBe(200);
      expect(unblockRes.body.success).toBe(true);

      // 4. Verify no longer blocked
      const listAfterRes = await request(app)
        .get('/api/friends/blocked')
        .set('Authorization', `Bearer ${token}`);

      expect(listAfterRes.body.some((b: any) => b.id === annoyingUser.id)).toBe(false);
    });
  });

  describe('5.6 & 5.7: Live Moderation Tools & In-Game Reporting', () => {
    it('should allow user to submit report and admin to inspect and mute offending player', async () => {
      const reporter = await createTestUser();
      const offender = await createTestUser();
      const admin = await createTestUser({ isAdmin: true });

      const reporterToken = generateTestToken(reporter.id);
      const adminToken = generateTestToken(admin.id, '15m', { role: 'ADMIN' });

      // 1. Reporter submits report
      const reportRes = await request(app)
        .post('/api/reports')
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reportedUserId: offender.id,
          reason: 'HARASSMENT',
          description: 'Spamming insults in the plaza',
        });

      expect(reportRes.status).toBe(201);
      expect(reportRes.body).toHaveProperty('reportId');

      // 2. Admin views reports
      const adminReportsRes = await request(app)
        .get('/api/admin/reports')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminReportsRes.status).toBe(200);
      expect(adminReportsRes.body.reports.some((r: any) => r.reportedUserId === offender.id)).toBe(true);

      // 3. Admin mutes offender for 24 hours
      const muteRes = await request(app)
        .post(`/api/admin/users/${offender.id}/mute`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hours: 24, reason: 'Harassment violation' });

      expect(muteRes.status).toBe(200);
      expect(muteRes.body.message).toMatch(/muted/i);

      // Verify offender is muted in DB
      const dbOffender = await prisma.user.findUnique({ where: { id: offender.id } });
      expect(dbOffender?.mutedUntil).not.toBeNull();
      expect(new Date(dbOffender!.mutedUntil!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('5.8 & 5.9: Clubs / Guilds & Sanctuaries', () => {
    it('should create a club, add members, and manage club operations', async () => {
      const leader = await createTestUser();
      const member = await createTestUser();

      // Leader creates club
      const club = await ClubService.createClub(leader.id, 'Haven Knights', 'A noble social guild', 'HK');
      expect(club.name).toBe('Haven Knights');
      expect(club.tag).toBe('HK');

      // Member joins club
      const joined = await ClubService.joinClub(member.id, club.id);
      expect(joined.clubId).toBe(club.id);
      expect(joined.role).toBe('MEMBER');

      // Check details
      const details = await ClubService.getClubDetails(club.id);
      expect(details?.members.length).toBe(2);
    });
  });

  describe('5.10: Offline Postcards & Mail', () => {
    it('should deliver gift with message to offline recipient and allow retrieval', async () => {
      const sender = await createTestUser({ havenCoins: 200 });
      const recipient = await createTestUser();
      const item = await createTestItem({ price: 30 });

      // Put item in sender inventory
      await prisma.inventory.create({
        data: { userId: sender.id, itemId: item.id, quantity: 1 },
      });

      // Sender gifts item with postcard message
      const gift = await ShopService.giftItem(
        sender.id,
        recipient.id,
        item.id,
        'Welcome to HavenWorld! Here is a welcome gift.'
      );

      expect(gift.receiverId).toBe(recipient.id);
      expect(gift.message).toBe('Welcome to HavenWorld! Here is a welcome gift.');

      // Recipient queries gifts / offline mail
      const recipientToken = generateTestToken(recipient.id);
      const mailRes = await request(app)
        .get('/api/users/gifts')
        .set('Authorization', `Bearer ${recipientToken}`);

      expect(mailRes.status).toBe(200);
      expect(mailRes.body.length).toBeGreaterThan(0);
      expect(mailRes.body[0].message).toBe('Welcome to HavenWorld! Here is a welcome gift.');
      expect(mailRes.body[0].sender.username).toBe(sender.username);
    });
  });
});
