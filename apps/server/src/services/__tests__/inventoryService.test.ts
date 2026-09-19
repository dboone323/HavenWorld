import { InventoryService } from '../InventoryService';
import { prisma } from '../../prisma';
import { createTestUser, createTestItem } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';
import { ItemNotFoundError, InsufficientFundsError } from '../../errors';

describe('InventoryService', () => {
  let service: InventoryService;

  beforeAll(async () => {
    service = new InventoryService(prisma);
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('should add an item to a user inventory and return the inventory entry', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    const inv = await service.addItem(user.id, item.id, 2);
    expect(inv).toBeDefined();
    expect(inv.userId).toBe(user.id);
    expect(inv.itemId).toBe(item.id);
    expect(inv.quantity).toBe(2);

    const fromDb = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user.id, itemId: item.id } },
    });
    expect(fromDb?.quantity).toBe(2);
  });

  it('should throw ItemNotFoundError when removing an item the user does not own', async () => {
    const user = await createTestUser();
    await expect(service.removeItem(user.id, 'non_existent_item_id')).rejects.toThrow(ItemNotFoundError);
  });

  it('should update both user balances atomically on a valid HavenCoin transfer', async () => {
    const sender = await createTestUser({ havenCoins: 500 });
    const receiver = await createTestUser({ havenCoins: 100 });

    const result = await service.transferCoins({
      fromUserId: sender.id,
      toUserId: receiver.id,
      amount: 150,
    });

    expect(result.success).toBe(true);

    const updatedSender = await prisma.user.findUnique({ where: { id: sender.id } });
    const updatedReceiver = await prisma.user.findUnique({ where: { id: receiver.id } });

    expect(updatedSender?.havenCoins).toBe(350);
    expect(updatedReceiver?.havenCoins).toBe(250);
  });

  it('should throw InsufficientFundsError when sender has insufficient HavenCoins', async () => {
    const sender = await createTestUser({ havenCoins: 50 });
    const receiver = await createTestUser({ havenCoins: 100 });

    await expect(
      service.transferCoins({
        fromUserId: sender.id,
        toUserId: receiver.id,
        amount: 100,
      })
    ).rejects.toThrow(InsufficientFundsError);

    // Verify balances unchanged
    const unchangedSender = await prisma.user.findUnique({ where: { id: sender.id } });
    expect(unchangedSender?.havenCoins).toBe(50);
  });

  it('should reject a negative coin transfer amount (economy exploit prevention)', async () => {
    const sender = await createTestUser({ havenCoins: 500 });
    const receiver = await createTestUser({ havenCoins: 100 });

    await expect(
      service.transferCoins({
        fromUserId: sender.id,
        toUserId: receiver.id,
        amount: -50,
      })
    ).rejects.toThrow('INVALID_AMOUNT');
  });

  it('should reject a coin transfer where sender and receiver are the same user', async () => {
    const user = await createTestUser({ havenCoins: 500 });

    await expect(
      service.transferCoins({
        fromUserId: user.id,
        toUserId: user.id,
        amount: 100,
      })
    ).rejects.toThrow('SELF_TRANSFER');
  });

  it('should cap earnings at the weekly maximum without rejecting the transaction', async () => {
    const user = await createTestUser({ havenCoins: 1000 });
    const weeklyMax = 500;

    // Earn 400
    const res1 = await service.earnCoins(user.id, 400, weeklyMax);
    expect(res1.coinsAwarded).toBe(400);

    // Attempt to earn 200 (only 100 should be awarded due to 500 cap)
    const res2 = await service.earnCoins(user.id, 200, weeklyMax);
    expect(res2.coinsAwarded).toBe(100);
    expect(res2.cappedAt).toBe(weeklyMax);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.havenCoins).toBe(1500); // 1000 + 400 + 100
  });

  it('should reject a second daily login streak claim on the same calendar day', async () => {
    const user = await createTestUser({ havenCoins: 100 });

    const firstClaim = await service.claimDailyLoginBonus(user.id);
    expect(firstClaim.success).toBe(true);

    await expect(service.claimDailyLoginBonus(user.id)).rejects.toThrow('ALREADY_CLAIMED_TODAY');
  });
});
