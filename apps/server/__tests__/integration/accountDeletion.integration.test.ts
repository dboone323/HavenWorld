import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestItem } from '../helpers/factories';
import { truncateAllTables } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';

describe('Account Deletion Flow (A2 Implementation)', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('rejects deletion without authentication with 401 or 403', async () => {
    const res = await request(app)
      .delete('/api/users/me')
      .send({ password: 'Password123!' });

    expect([401, 403]).toContain(res.status);
  });

  it('rejects deletion with missing password with 400', async () => {
    const user = await createTestUser();
    const token = generateTestToken(user.id, '15m', { role: user.role });

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('rejects deletion with incorrect password with 401', async () => {
    const user = await createTestUser({ password: 'CorrectPassword123!' });
    const token = generateTestToken(user.id, '15m', { role: user.role });

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'WrongPassword999!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect password/i);

    // Verify user still exists in database
    const userInDb = await prisma.user.findUnique({ where: { id: user.id } });
    expect(userInDb).not.toBeNull();
  });

  it('permanently deletes user, avatar, inventory, owned rooms, and chat messages in a transaction', async () => {
    const password = 'MySecretPass123!';
    const user = await createTestUser({ password });
    const token = generateTestToken(user.id, '15m', { role: user.role });

    // 1. Create item & inventory
    const item = await createTestItem({ name: 'Delete Test Chair' });
    await prisma.inventory.create({
      data: {
        userId: user.id,
        itemId: item.id,
        quantity: 1,
      },
    });

    // 2. Create personal room and furniture
    const room = await prisma.room.create({
      data: {
        name: `${user.username}'s Loft`,
        ownerId: user.id,
        accessMode: 'PUBLIC',
        backgroundKey: 'map-personal-room',
      },
    });
    await prisma.roomFurniture.create({
      data: {
        roomId: room.id,
        itemId: item.id,
        placedBy: user.id,
        x: 1,
        y: 0,
        z: 1,
        rotation: 0,
      },
    });

    // 3. Create chat message authored by user
    await prisma.chatMessage.create({
      data: {
        roomId: room.id,
        senderId: user.id,
        content: 'Goodbye world!',
      },
    });

    // Verify all records exist prior to deletion
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.avatar.findUnique({ where: { userId: user.id } })).not.toBeNull();
    expect(await prisma.inventory.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.room.findUnique({ where: { id: room.id } })).not.toBeNull();
    expect(await prisma.roomFurniture.count({ where: { placedBy: user.id } })).toBe(1);
    expect(await prisma.chatMessage.count({ where: { senderId: user.id } })).toBe(1);

    // 4. Execute DELETE /api/users/me
    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    // 5. Verify ALL data has been purged from database
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.avatar.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await prisma.inventory.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.room.findUnique({ where: { id: room.id } })).toBeNull();
    expect(await prisma.roomFurniture.count({ where: { placedBy: user.id } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { senderId: user.id } })).toBe(0);
  });
});
