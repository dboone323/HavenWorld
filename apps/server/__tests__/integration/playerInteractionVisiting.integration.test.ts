import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';

describe('Phase 1 Integration: Player Interaction & Visit Flow', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('Personal Room & Profile Resolution', () => {
    it('should resolve personal room by user id and in username public profile', async () => {
      const hostUser = await createTestUser({ username: 'visithost' });
      const guestUser = await createTestUser({ username: 'visitguest' });
      const guestToken = generateTestToken(guestUser.id);

      // Create personal room for host
      const hostRoom = await prisma.room.create({
        data: {
          name: "Host's Sanctuary Loft",
          description: 'A cozy personal loft',
          ownerId: hostUser.id,
          backgroundKey: 'map-personal-room',
          isPublic: false,
          accessMode: 'PUBLIC',
          width: 14,
          height: 14,
        },
      });

      // 1. Resolve room via GET /api/users/id/:userId/room
      const roomByIdRes = await request(app)
        .get(`/api/users/id/${hostUser.id}/room`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(roomByIdRes.status).toBe(200);
      expect(roomByIdRes.body.id).toBe(hostRoom.id);
      expect(roomByIdRes.body.name).toBe("Host's Sanctuary Loft");

      // 2. Resolve room via GET /api/users/:username
      const profileRes = await request(app)
        .get(`/api/users/${hostUser.username}`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(profileRes.status).toBe(200);
      expect(profileRes.body.username).toBe(hostUser.username);
      expect(profileRes.body.personalRoom).not.toBeNull();
      expect(profileRes.body.personalRoom.id).toBe(hostRoom.id);
    });

    it('should return 404 when querying room for user with no personal loft', async () => {
      const emptyUser = await createTestUser({ username: 'noloftuser' });
      const guestUser = await createTestUser({ username: 'queryingguest' });
      const guestToken = generateTestToken(guestUser.id);

      const res = await request(app)
        .get(`/api/users/id/${emptyUser.id}/room`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Personal room not found.');
    });
  });

  describe('Visiting via Teleport Gating', () => {
    it('should permit teleporting into an open room and block private lofts without access', async () => {
      const host = await createTestUser({ username: 'lofthost' });
      const visitor = await createTestUser({ username: 'loftvisitor' });
      const visitorToken = generateTestToken(visitor.id);

      const publicLoft = await prisma.room.create({
        data: {
          name: 'Open Loft',
          ownerId: host.id,
          backgroundKey: 'map-personal-room',
          accessMode: 'PUBLIC',
          privacy: 'PUBLIC',
        },
      });

      const privateLoft = await prisma.room.create({
        data: {
          name: 'Private Sanctuary',
          ownerId: host.id,
          backgroundKey: 'map-personal-room',
          accessMode: 'PRIVATE',
          privacy: 'LOCKED',
          awayMessage: 'Currently resting, please visit later.',
        },
      });

      // Teleport to open room -> allowed
      const openRes = await request(app)
        .post(`/api/rooms/${publicLoft.id}/teleport`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .send({ targetRoomId: publicLoft.id });

      expect(openRes.status).toBe(200);
      expect(openRes.body.allowed).toBe(true);

      // Teleport to private room without loftAccess -> blocked 403
      const privateRes = await request(app)
        .post(`/api/rooms/${privateLoft.id}/teleport`)
        .set('Authorization', `Bearer ${visitorToken}`)
        .send({ targetRoomId: privateLoft.id });

      expect(privateRes.status).toBe(403);
      expect(privateRes.body.error).toBe('Cannot teleport to target room');
      expect(privateRes.body.awayMessage).toBe('Currently resting, please visit later.');
    });
  });

  describe('Friend Request Flow from Context Menu', () => {
    it('should create a pending friend request and prevent self-friending', async () => {
      const userA = await createTestUser({ username: 'friend_a' });
      const userB = await createTestUser({ username: 'friend_b' });
      const tokenA = generateTestToken(userA.id);

      // Self friend request must fail
      const selfRes = await request(app)
        .post('/api/friends/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userA.id });

      expect(selfRes.status).toBe(400);

      // Valid friend request
      const validRes = await request(app)
        .post('/api/friends/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(validRes.status).toBe(201);
      expect(validRes.body.status).toBe('PENDING');

      // Verify row in database
      const dbFriend = await prisma.friend.findFirst({
        where: { requesterId: userA.id, addresseeId: userB.id },
      });
      expect(dbFriend).not.toBeNull();
      expect(dbFriend?.status).toBe('PENDING');
    });
  });
});
