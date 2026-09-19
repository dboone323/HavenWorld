import { TradeManager } from '../TradeManager';
import { roomManager } from '../RoomManager';
import { prisma } from '../../prisma';
import { createTestUser, createTestItem, defaultTestAvatar } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';

describe('TradeManager (P2P Trade)', () => {
  afterAll(async () => {
    await truncateAllTables();
  });

  it('should reject trade request when players are not in the same room', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_b', 'sock_2', { id: user2.id, username: 'User2', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    expect(() => TradeManager.requestTrade(user1.id, user2.id)).toThrow('Both players must be in the same room to trade');

    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should reject trade request when players are too far apart', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    // 20 units apart (exceeds 4.5 unit proximity threshold)
    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_a', 'sock_2', { id: user2.id, username: 'User2', x: 20, y: 0, z: 20, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    expect(() => TradeManager.requestTrade(user1.id, user2.id)).toThrow('You are too far away from the other player to trade');

    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should initiate trade when players are close in the same room', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_a', 'sock_2', { id: user2.id, username: 'User2', x: 2, y: 0, z: 2, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    const session = TradeManager.requestTrade(user1.id, user2.id);
    expect(session).toBeDefined();
    expect(session.id).toBeDefined();

    // Cleanup
    TradeManager.cancelTrade(user1.id, 'Test complete');
    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should transition trade state to LOCKED when both users lock their offers', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_a', 'sock_2', { id: user2.id, username: 'User2', x: 1, y: 0, z: 1, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    TradeManager.requestTrade(user1.id, user2.id);
    TradeManager.acceptTrade(user2.id);

    // User 1 sets ready
    TradeManager.setReady(user1.id);
    let session = TradeManager.getSessionForUser(user1.id);
    expect(session?.initiatorReady).toBe(true);
    expect(session?.state).toBe('OFFER_PHASE');

    // User 2 sets ready -> transitions to LOCKED
    TradeManager.setReady(user2.id);
    session = TradeManager.getSessionForUser(user2.id);
    expect(session?.receiverReady).toBe(true);
    expect(session?.state).toBe('LOCKED');

    TradeManager.cancelTrade(user1.id, 'Test complete');
    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should revert trade state to OFFER_PHASE when an offer is modified after lock', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_a', 'sock_2', { id: user2.id, username: 'User2', x: 1, y: 0, z: 1, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    TradeManager.requestTrade(user1.id, user2.id);
    TradeManager.acceptTrade(user2.id);

    TradeManager.setReady(user1.id);
    TradeManager.setReady(user2.id);

    // Modify offer -> resets both ready states and reverts to OFFER_PHASE
    TradeManager.offerCoins(user1.id, 10);
    const session = TradeManager.getSessionForUser(user1.id);
    expect(session?.state).toBe('OFFER_PHASE');
    expect(session?.initiatorReady).toBe(false);
    expect(session?.receiverReady).toBe(false);

    TradeManager.cancelTrade(user1.id, 'Test complete');
    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should execute an atomic swap and audit log when both confirm', async () => {
    const user1 = await createTestUser({ havenCoins: 500 });
    const user2 = await createTestUser({ havenCoins: 200 });

    const item1 = await createTestItem({ name: 'Trader Chair' });
    const inv1 = await prisma.inventory.create({
      data: { userId: user1.id, itemId: item1.id, quantity: 1 },
    });

    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_a', 'sock_2', { id: user2.id, username: 'User2', x: 1, y: 0, z: 1, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    TradeManager.requestTrade(user1.id, user2.id);
    TradeManager.acceptTrade(user2.id);

    // User 1 offers item1; User 2 offers 50 coins
    TradeManager.offerItem(user1.id, 0, item1.id, item1.name);
    TradeManager.offerCoins(user2.id, 50);

    TradeManager.setReady(user1.id);
    TradeManager.setReady(user2.id);

    // Both confirm
    await TradeManager.confirmTrade(user1.id);
    await TradeManager.confirmTrade(user2.id);

    // Verify balances swapped
    const u1After = await prisma.user.findUnique({ where: { id: user1.id } });
    const u2After = await prisma.user.findUnique({ where: { id: user2.id } });
    expect(u1After?.havenCoins).toBe(550);
    expect(u2After?.havenCoins).toBe(150);

    // Verify item ownership transferred to user2
    const u2Inv = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user2.id, itemId: item1.id } },
    });
    expect(u2Inv).toBeDefined();
    expect(u2Inv?.quantity).toBe(1);

    // Verify audit log created
    const tradeLog = await prisma.tradeLog.findFirst({
      where: { initiatorId: user1.id, receiverId: user2.id },
    });
    expect(tradeLog).toBeDefined();
    expect(tradeLog?.receiverCoins).toBe(50);

    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should cancel trade and transfer no items regardless of current state', async () => {
    const user1 = await createTestUser({ havenCoins: 300 });
    const user2 = await createTestUser({ havenCoins: 300 });

    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });
    roomManager.joinRoom('room_a', 'sock_2', { id: user2.id, username: 'User2', x: 1, y: 0, z: 1, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    TradeManager.requestTrade(user1.id, user2.id);
    TradeManager.acceptTrade(user2.id);

    TradeManager.cancelTrade(user1.id, 'Player cancelled');

    const u1 = await prisma.user.findUnique({ where: { id: user1.id } });
    const u2 = await prisma.user.findUnique({ where: { id: user2.id } });
    expect(u1?.havenCoins).toBe(300);
    expect(u2?.havenCoins).toBe(300);

    roomManager.leaveRoom('sock_1');
    roomManager.leaveRoom('sock_2');
  });

  it('should reject a player from initiating a trade with themselves', async () => {
    const user1 = await createTestUser();
    roomManager.joinRoom('room_a', 'sock_1', { id: user1.id, username: 'User1', x: 0, y: 0, z: 0, rotY: 0, direction: 'down', isMoving: false, avatar: defaultTestAvatar });

    expect(() => TradeManager.requestTrade(user1.id, user1.id)).toThrow('You cannot trade with yourself');

    roomManager.leaveRoom('sock_1');
  });
});
