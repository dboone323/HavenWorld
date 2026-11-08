import { InventoryService } from '../InventoryService';
import { prisma } from '../../prisma';
import { createTestUser, createTestItem, createTestRoom } from '../../../__tests__/helpers/factories';
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

  it('should increment quantity when adding an item already present in inventory', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    await service.addItem(user.id, item.id, 2);
    const updated = await service.addItem(user.id, item.id, 3);

    expect(updated.quantity).toBe(5);

    const fromDb = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user.id, itemId: item.id } },
    });
    expect(fromDb?.quantity).toBe(5);
  });

  it('should return true if user owns the item and false otherwise', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    expect(await service.hasItem(user.id, item.id)).toBe(false);

    await service.addItem(user.id, item.id, 1);
    expect(await service.hasItem(user.id, item.id)).toBe(true);
  });

  it('should check if user owns all items in a specified list', async () => {
    const user = await createTestUser();
    const item1 = await createTestItem();
    const item2 = await createTestItem();
    const item3 = await createTestItem();

    await service.addItem(user.id, item1.id, 1);
    await service.addItem(user.id, item2.id, 1);

    expect(await service.hasAllItems(user.id, [item1.id, item2.id])).toBe(true);
    expect(await service.hasAllItems(user.id, [item1.id, item2.id, item3.id])).toBe(false);
  });

  it('should throw ItemNotFoundError when removing an item the user does not own', async () => {
    const user = await createTestUser();
    await expect(service.removeItem(user.id, 'non_existent_item_id')).rejects.toThrow(ItemNotFoundError);
  });

  it('should decrement quantity when removing fewer items than owned', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    await service.addItem(user.id, item.id, 4);
    const updated = await service.removeItem(user.id, item.id, 1);

    expect(updated.quantity).toBe(3);

    const fromDb = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user.id, itemId: item.id } },
    });
    expect(fromDb?.quantity).toBe(3);
  });

  it('should delete inventory record when removing exact owned quantity', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    await service.addItem(user.id, item.id, 2);
    await service.removeItem(user.id, item.id, 2);

    const fromDb = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user.id, itemId: item.id } },
    });
    expect(fromDb).toBeNull();
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

  it('should reject recycling a default free starter item with STARTER_ITEM_NOT_RECYCLABLE', async () => {
    const user = await createTestUser();
    const starterItem = await prisma.item.upsert({
      where: { id: 'furniture-chair' },
      create: {
        id: 'furniture-chair',
        name: 'Starter Chair',
        description: 'Starter furniture',
        category: 'FURNITURE',
        rarity: 'COMMON',
        price: 0,
        spriteKey: 'furniture-chair',
      },
      update: {},
    });

    await service.addItem(user.id, starterItem.id, 1);
    await expect(service.recycleItem(user.id, starterItem.id, 1)).rejects.toThrow(
      'STARTER_ITEM_NOT_RECYCLABLE'
    );
  });

  it('should reject recycling an item equipped on the avatar with ITEM_CURRENTLY_EQUIPPED', async () => {
    const user = await createTestUser();
    const item = await createTestItem({ category: 'CLOTHING_BODY' });

    await service.addItem(user.id, item.id, 1);
    await prisma.avatar.update({
      where: { userId: user.id },
      data: { outfitBody: item.id },
    });

    await expect(service.recycleItem(user.id, item.id, 1)).rejects.toThrow(
      'ITEM_CURRENTLY_EQUIPPED'
    );
  });

  it('should decrement inventory quantity when partially recycling a stack', async () => {
    const user = await createTestUser({ havenCoins: 0 });
    const item = await createTestItem({ category: 'FURNITURE' });

    await service.addItem(user.id, item.id, 3);
    const result = await service.recycleItem(user.id, item.id, 1);

    expect(result.quantityRecycled).toBe(1);
    expect(result.coinsAwarded).toBe(5);

    const remaining = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: user.id, itemId: item.id } },
    });
    expect(remaining?.quantity).toBe(2);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.havenCoins).toBe(5);
  });

  it('should return empty summary when user has no salvageable duplicate items', async () => {
    const user = await createTestUser();
    const summary = await service.salvageDuplicates(user.id);
    expect(summary).toEqual({
      tierBreakdown: {},
      totalCoinsAwarded: 0,
      itemsSalvaged: 0,
    });
  });

  it('should throw ROOM_NOT_FOUND when placing furniture in a non-existent room', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    await expect(
      service.placeFurnitureItem(user.id, '00000000-0000-0000-0000-000000000000', {
        itemId: item.id,
        x: 0,
        y: 0,
      })
    ).rejects.toThrow('ROOM_NOT_FOUND');
  });

  it('should throw NOT_ROOM_DECORATOR when placing furniture without permissions', async () => {
    const owner = await createTestUser();
    const otherUser = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    await service.addItem(otherUser.id, item.id, 1);

    await expect(
      service.placeFurnitureItem(otherUser.id, room.id, {
        itemId: item.id,
        x: 0,
        y: 0,
      })
    ).rejects.toThrow('NOT_ROOM_DECORATOR');
  });

  it('should throw ITEM_NOT_OWNED when placing an item user does not possess', async () => {
    const owner = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    await expect(
      service.placeFurnitureItem(owner.id, room.id, {
        itemId: item.id,
        x: 0,
        y: 0,
      })
    ).rejects.toThrow('ITEM_NOT_OWNED');
  });

  it('should decrement inventory quantity when placing one item from a stack > 1', async () => {
    const owner = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    await service.addItem(owner.id, item.id, 3);

    const placed = await service.placeFurnitureItem(owner.id, room.id, {
      itemId: item.id,
      x: 5,
      y: 10,
    });

    expect(placed).toBeDefined();
    expect(placed.itemId).toBe(item.id);

    const inv = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: owner.id, itemId: item.id } },
    });
    expect(inv?.quantity).toBe(2);
  });

  it('should throw FURNITURE_NOT_FOUND when picking up non-existent furniture', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);

    await expect(
      service.pickupFurnitureItem(user.id, room.id, '00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow('FURNITURE_NOT_FOUND');
  });

  it('should throw NOT_ROOM_DECORATOR when an unauthorized user attempts to pick up furniture', async () => {
    const owner = await createTestUser();
    const otherUser = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    await service.addItem(owner.id, item.id, 1);
    const placed = await service.placeFurnitureItem(owner.id, room.id, {
      itemId: item.id,
      x: 0,
      y: 0,
    });

    await expect(
      service.pickupFurnitureItem(otherUser.id, room.id, placed.id)
    ).rejects.toThrow('NOT_ROOM_DECORATOR');
  });

  it('should remove furniture and return item to placer inventory atomically', async () => {
    const owner = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    await service.addItem(owner.id, item.id, 1);
    const placed = await service.placeFurnitureItem(owner.id, room.id, {
      itemId: item.id,
      x: 1,
      y: 2,
    });

    // Inventory was deleted because quantity was 1
    const invAfterPlace = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: owner.id, itemId: item.id } },
    });
    expect(invAfterPlace).toBeNull();

    // Pick up furniture
    const pickedUp = await service.pickupFurnitureItem(owner.id, room.id, placed.id);
    expect(pickedUp.id).toBe(placed.id);

    // Verify roomFurniture is deleted
    const dbFurniture = await prisma.roomFurniture.findUnique({
      where: { id: placed.id },
    });
    expect(dbFurniture).toBeNull();

    // Verify returned to inventory
    const invAfterPickup = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: owner.id, itemId: item.id } },
    });
    expect(invAfterPickup?.quantity).toBe(1);
  });

  it('should allow room owner to pickup furniture placed by another decorator and return it to placer', async () => {
    const owner = await createTestUser();
    const decorator = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    // Add decorator to room
    await prisma.roomDecorator.create({
      data: {
        roomId: room.id,
        userId: decorator.id,
      },
    });

    // Decorator places item
    await service.addItem(decorator.id, item.id, 1);
    const placed = await service.placeFurnitureItem(decorator.id, room.id, {
      itemId: item.id,
      x: 3,
      y: 4,
    });

    // Room owner picks it up
    await service.pickupFurnitureItem(owner.id, room.id, placed.id);

    // Returned to decorator's inventory, not owner's
    const decoratorInv = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: decorator.id, itemId: item.id } },
    });
    expect(decoratorInv?.quantity).toBe(1);

    const ownerInv = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: owner.id, itemId: item.id } },
    });
    expect(ownerInv).toBeNull();
  });

  it('should allow room decorator to pickup furniture placed by someone else', async () => {
    const owner = await createTestUser();
    const decorator = await createTestUser();
    const room = await createTestRoom(owner.id);
    const item = await createTestItem();

    await prisma.roomDecorator.create({
      data: {
        roomId: room.id,
        userId: decorator.id,
      },
    });

    await service.addItem(owner.id, item.id, 1);
    const placed = await service.placeFurnitureItem(owner.id, room.id, {
      itemId: item.id,
      x: 3,
      y: 4,
    });

    await service.pickupFurnitureItem(decorator.id, room.id, placed.id);

    const ownerInv = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: owner.id, itemId: item.id } },
    });
    expect(ownerInv?.quantity).toBe(1);
  });

  it('should grant default starter items to a user', async () => {
    const user = await createTestUser();
    await service.grantDefaultItems(user.id);
    const inv = await service.getUserInventory(user.id);
    expect(inv.length).toBeGreaterThan(0);
  });
});

