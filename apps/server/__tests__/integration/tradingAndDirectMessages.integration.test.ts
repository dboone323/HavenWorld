import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO, Socket } from 'socket.io-client';
import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { registerSocketHandlers } from '../../src/sockets';
import { TradeManager } from '../../src/services/TradeManager';
import { createTestUser } from '../helpers/factories';
import { createAuthenticatedSocket, waitForEvent, closeAllSockets } from '../helpers/socketHelpers';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';
import { SOCKET_EVENTS } from '@havenworld/shared';

describe('Phase 2 Integration: Direct Messaging & Trading Safeguards', () => {
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: SocketIOServer;
  let serverUrl: string;
  let sockets: Socket[] = [];

  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    registerSocketHandlers(ioServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const addr = httpServer.address() as { port: number };
    serverUrl = `http://localhost:${addr.port}`;
  });

  afterEach(async () => {
    await closeAllSockets(sockets);
    sockets = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    ioServer.close();
    await truncateAllTables();
  });

  describe('Direct Messaging (1:1 DMs)', () => {
    it('should deliver DM to receiver and persist unread message in DB', async () => {
      const sender = await createTestUser({ username: 'dm_alice' });
      const receiver = await createTestUser({ username: 'dm_bob' });

      const socketSender = await createAuthenticatedSocket(serverUrl, sender.id, sockets, { username: sender.username });
      const socketReceiver = await createAuthenticatedSocket(serverUrl, receiver.id, sockets, { username: receiver.username });

      // Alice sends DM to Bob
      socketSender.emit(SOCKET_EVENTS.DM_SEND, {
        receiverId: receiver.id,
        content: 'Hey Bob, nice room!',
      });

      // Both receiver and sender receive dm:receive event
      const receivedOnBob = await waitForEvent(socketReceiver, SOCKET_EVENTS.DM_RECEIVE, 5000);
      expect(receivedOnBob).toBeDefined();
      expect(receivedOnBob.senderId).toBe(sender.id);
      expect(receivedOnBob.receiverId).toBe(receiver.id);
      expect(receivedOnBob.content).toBe('Hey Bob, nice room!');

      // Check DB persistence
      const saved = await prisma.directMessage.findFirst({
        where: { senderId: sender.id, receiverId: receiver.id },
      });
      expect(saved).not.toBeNull();
      expect(saved?.read).toBe(false);

      // Verify REST API returns message history
      const bobToken = generateTestToken(receiver.id);
      const res = await request(app)
        .get(`/api/friends/${sender.id}/dms`)
        .set('Authorization', `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].content).toBe('Hey Bob, nice room!');
    });

    it('should reject DM if sender is blocked by receiver', async () => {
      const sender = await createTestUser({ username: 'dm_charlie' });
      const receiver = await createTestUser({ username: 'dm_dave' });

      // Receiver blocks sender
      await prisma.friend.create({
        data: {
          requesterId: receiver.id,
          addresseeId: sender.id,
          status: 'BLOCKED',
        },
      });

      const socketSender = await createAuthenticatedSocket(serverUrl, sender.id, sockets, { username: sender.username });

      socketSender.emit(SOCKET_EVENTS.DM_SEND, {
        receiverId: receiver.id,
        content: 'Unblock me please!',
      });

      const dmErr = await waitForEvent(socketSender, SOCKET_EVENTS.DM_ERROR, 5000);
      expect(dmErr).toBeDefined();
      expect(dmErr.code).toBe('BLOCKED');
    });

    it('should mark messages as read via dm:read socket event', async () => {
      const sender = await createTestUser({ username: 'dm_eve' });
      const receiver = await createTestUser({ username: 'dm_frank' });

      const dm = await prisma.directMessage.create({
        data: {
          senderId: sender.id,
          receiverId: receiver.id,
          content: 'Hello Frank',
          read: false,
        },
      });

      const socketReceiver = await createAuthenticatedSocket(serverUrl, receiver.id, sockets, { username: receiver.username });

      socketReceiver.emit(SOCKET_EVENTS.DM_READ, { partnerId: sender.id });

      // Poll DB until read is updated
      let updated = false;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const check = await prisma.directMessage.findUnique({ where: { id: dm.id } });
        if (check?.read) {
          updated = true;
          break;
        }
      }
      expect(updated).toBe(true);
    });
  });

  describe('Trading Safeguards (6 Slots, Item Restrictions, Equipped Check)', () => {
    it('should reject offering an item that has isTradeable: false', async () => {
      const userA = await createTestUser({ username: 'trade_alice' });
      const userB = await createTestUser({ username: 'trade_bob' });

      // Create non-tradeable item
      const item = await prisma.item.create({
        data: {
          name: 'Soulbound Cloak',
          category: 'CLOTHING_BODY',
          rarity: 'RARE',
          price: 100,
          spriteKey: 'cloak_rare',
          isTradeable: false,
        },
      });

      // Add to userA inventory
      await prisma.inventory.create({
        data: {
          userId: userA.id,
          itemId: item.id,
          quantity: 1,
        },
      });

      const socketA = await createAuthenticatedSocket(serverUrl, userA.id, sockets, { username: userA.username });
      await createAuthenticatedSocket(serverUrl, userB.id, sockets, { username: userB.username });

      // Start trade
      TradeManager.startTestSession(userA.id, userB.id);

      // Try offering non-tradeable item in slot 0
      socketA.emit(SOCKET_EVENTS.OFFER_ITEM, {
        slotIndex: 0,
        inventoryItemId: item.id,
        name: item.name,
      });

      const err = await waitForEvent(socketA, SOCKET_EVENTS.ERROR, 5000);
      expect(err).toBeDefined();
      expect(err.message).toMatch(/not tradeable/i);

      // Clean up trade session
      TradeManager.cancelTrade(userA.id);
    });

    it('should reject offering an item that is currently equipped by avatar', async () => {
      const userA = await createTestUser({ username: 'trade_charlie' });
      const userB = await createTestUser({ username: 'trade_dave' });

      // Create tradeable shirt
      const item = await prisma.item.create({
        data: {
          name: 'Hero Shirt',
          category: 'CLOTHING_BODY',
          rarity: 'COMMON',
          price: 150,
          spriteKey: 'shirt_hero',
          isTradeable: true,
        },
      });

      // Add to userA inventory and equip to avatar
      await prisma.inventory.create({
        data: {
          userId: userA.id,
          itemId: item.id,
          quantity: 1,
        },
      });

      await prisma.avatar.update({
        where: { userId: userA.id },
        data: { outfitBody: item.id },
      });

      const socketA = await createAuthenticatedSocket(serverUrl, userA.id, sockets, { username: userA.username });
      await createAuthenticatedSocket(serverUrl, userB.id, sockets, { username: userB.username });

      // Start trade
      TradeManager.startTestSession(userA.id, userB.id);

      // Try offering equipped shirt in slot 5 (6th slot: index 0..5)
      socketA.emit(SOCKET_EVENTS.OFFER_ITEM, {
        slotIndex: 5,
        inventoryItemId: item.id,
        name: item.name,
      });

      const err = await waitForEvent(socketA, SOCKET_EVENTS.ERROR, 5000);
      expect(err).toBeDefined();
      expect(err.message).toMatch(/equipped/i);

      // Clean up trade session
      TradeManager.cancelTrade(userA.id);
    });
  });
});
