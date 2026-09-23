import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestRoom, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';
import { PrivacyManager } from '../../src/services/PrivacyManager';

describe('Track 3 Integration: The "Loft" System & Environment Editing', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('3.5: Room Expansions', () => {
    it('should expand room dimensions and deduct HavenCoins from owner', async () => {
      const owner = await createTestUser({ havenCoins: 500 });
      const room = await createTestRoom(owner.id, { isPublic: false });
      const token = generateTestToken(owner.id);

      // Current room dimensions default to 20x15. Expand to 24x18 (+4 width, +3 height = +7 delta = 175 coins)
      const res = await request(app)
        .post(`/api/rooms/${room.id}/expand`)
        .set('Authorization', `Bearer ${token}`)
        .send({ width: 24, height: 18 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.width).toBe(24);
      expect(res.body.height).toBe(18);
      expect(res.body.coinsSpent).toBe(175);
      expect(res.body.newBalance).toBe(325);

      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom?.width).toBe(24);
      expect(dbRoom?.height).toBe(18);

      const dbUser = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(dbUser?.havenCoins).toBe(325);
    });

    it('should reject room expansion if user has insufficient HavenCoins', async () => {
      const owner = await createTestUser({ havenCoins: 50 });
      const room = await createTestRoom(owner.id, { isPublic: false });
      const token = generateTestToken(owner.id);

      const res = await request(app)
        .post(`/api/rooms/${room.id}/expand`)
        .set('Authorization', `Bearer ${token}`)
        .send({ width: 25, height: 20 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/insufficient/i);
    });

    it('should reject room expansion if user is not the room owner', async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser({ havenCoins: 1000 });
      const room = await createTestRoom(owner.id);
      const strangerToken = generateTestToken(stranger.id);

      const res = await request(app)
        .post(`/api/rooms/${room.id}/expand`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ width: 22, height: 18 });

      expect(res.status).toBe(403);
    });
  });

  describe('3.8: Co-Building Rights & Decorators', () => {
    it('should allow owner to grant and revoke decorator rights and allow decorators to place furniture', async () => {
      const owner = await createTestUser();
      const friend = await createTestUser();
      const stranger = await createTestUser();
      const room = await createTestRoom(owner.id, { isPublic: false });
      const item = await createTestItem({ price: 10 });

      // Give friend the item in their inventory
      await prisma.inventory.create({
        data: { userId: friend.id, itemId: item.id, quantity: 1 },
      });

      const ownerToken = generateTestToken(owner.id);
      const friendToken = generateTestToken(friend.id);
      const strangerToken = generateTestToken(stranger.id);

      // Stranger tries to place furniture -> 403
      const failRes = await request(app)
        .post(`/api/rooms/${room.id}/furniture`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ itemId: item.id, x: 5, y: 5 });
      expect(failRes.status).toBe(403);

      // Owner grants decorator rights to friend
      const grantRes = await request(app)
        .post(`/api/rooms/${room.id}/decorators`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ targetUserId: friend.id });
      expect(grantRes.status).toBe(201);

      // Friend can now place furniture
      const placeRes = await request(app)
        .post(`/api/rooms/${room.id}/furniture`)
        .set('Authorization', `Bearer ${friendToken}`)
        .send({ itemId: item.id, x: 6, y: 6 });
      expect(placeRes.status).toBe(201);

      // Owner revokes decorator rights
      const revokeRes = await request(app)
        .delete(`/api/rooms/${room.id}/decorators/${friend.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(revokeRes.status).toBe(200);

      // Friend can no longer place furniture
      const blockedRes = await request(app)
        .post(`/api/rooms/${room.id}/furniture`)
        .set('Authorization', `Bearer ${friendToken}`)
        .send({ itemId: item.id, x: 7, y: 7 });
      expect(blockedRes.status).toBe(403);
    });
  });

  describe('3.6 & 3.7: Door Linking, Permissions & Teleportation', () => {
    it('should allow teleportation to public room and enforce access controls on locked rooms', async () => {
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const publicRoom = await createTestRoom(owner.id, { privacy: 'PUBLIC' });
      const lockedRoom = await createTestRoom(owner.id, {
        privacy: 'LOCKED',
        name: 'Secret Chamber',
      });

      const visitorToken = generateTestToken(visitor.id);

      // Teleport to public room
      const pubRes = await request(app)
        .post(`/api/rooms/${publicRoom.id}/teleport`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .send({ targetRoomId: publicRoom.id });
      expect(pubRes.status).toBe(200);
      expect(pubRes.body.allowed).toBe(true);

      // Teleport to locked room
      const lockRes = await request(app)
        .post(`/api/rooms/${lockedRoom.id}/teleport`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .send({ targetRoomId: lockedRoom.id });
      expect(lockRes.status).toBe(403);
      expect(lockRes.body.reason).toBe('ROOM_LOCKED');
    });

    it('should handle doorbell knocks and owner admissions', async () => {
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const room = await createTestRoom(owner.id, { privacy: 'LOCKED' });

      // Visitor rings doorbell
      const knock = await PrivacyManager.ringDoorbell(visitor.id, room.id);
      expect(knock.sent).toBe(true);

      // Owner decides to admit visitor
      const decision = await PrivacyManager.decideDoorbell(owner.id, visitor.id, room.id, true);
      expect(decision.success).toBe(true);
      expect(decision.admitted).toBe(true);

      // Verify access log recorded
      const accessLog = await prisma.roomAccessLog.findFirst({
        where: { roomId: room.id, visitorId: visitor.id },
      });
      expect(accessLog).not.toBeNull();
    });
  });

  describe('3.10: Ambient Room Settings', () => {
    it('should allow owner or decorator to update ambient mood settings', async () => {
      const owner = await createTestUser();
      const room = await createTestRoom(owner.id);
      const token = generateTestToken(owner.id);

      const res = await request(app)
        .put(`/api/rooms/${room.id}/ambient`)
        .set('Authorization', `Bearer ${token}`)
        .send({ moodPreset: 'sunset', theme: 'warm_wood' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.moodPreset).toBe('sunset');

      const updated = await prisma.room.findUnique({ where: { id: room.id } });
      expect(updated?.moodPreset).toBe('sunset');
    });
  });
});
