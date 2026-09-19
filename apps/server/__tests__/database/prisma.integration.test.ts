import { prisma } from '../../src/prisma';
import { createTestUser, createTestRoom, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';

describe('Prisma Database Integration — Schema Constraints', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('should enforce unique email constraint on the User table', async () => {
    await createTestUser({ email: 'duplicate_test@test.com' });

    let err: any;
    try {
      await prisma.user.create({
        data: {
          email: 'duplicate_test@test.com',
          username: 'dup_user_unique',
          passwordHash: 'dummy_hash',
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('P2002');
  });

  it('should cascade-delete the Avatar when its parent User is deleted', async () => {
    const user = await createTestUser();
    const avatarBefore = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(avatarBefore).not.toBeNull();

    await prisma.user.delete({ where: { id: user.id } });

    const avatarAfter = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(avatarAfter).toBeNull();
  });

  it('should enforce FK constraints on Inventory referencing both User and Item', async () => {
    const user = await createTestUser();
    const item = await createTestItem();

    const inv = await prisma.inventory.create({
      data: {
        userId: user.id,
        itemId: item.id,
        quantity: 1,
      },
    });
    expect(inv.userId).toBe(user.id);
    expect(inv.itemId).toBe(item.id);

    // Foreign key to non-existent item must fail
    let invErr: any;
    try {
      await prisma.inventory.create({
        data: {
          userId: user.id,
          itemId: 'non_existent_item_uuid',
          quantity: 1,
        },
      });
    } catch (e) {
      invErr = e;
    }
    expect(invErr).toBeDefined();
    expect(invErr.code).toBe('P2003');
  });

  it('should cascade-delete RoomFurniture when the parent Room is deleted', async () => {
    const user = await createTestUser();
    const room = await createTestRoom(user.id);
    const item = await createTestItem();

    const furniture = await prisma.roomFurniture.create({
      data: {
        roomId: room.id,
        itemId: item.id,
        placedBy: user.id,
        x: 1.5,
        y: 0,
        z: 2.5,
        rotation: 90,
      },
    });

    await prisma.room.delete({ where: { id: room.id } });

    const deletedFurniture = await prisma.roomFurniture.findUnique({
      where: { id: furniture.id },
    });
    expect(deletedFurniture).toBeNull();
  });

  it('should enforce FK constraint on FishCatch referencing User', async () => {
    const user = await createTestUser();
    const catchEntry = await prisma.fishCatch.create({
      data: {
        userId: user.id,
        species: 'BASS',
        weightLbs: 3.5,
        coinsEarned: 25,
      },
    });
    expect(catchEntry.userId).toBe(user.id);

    // Foreign key to non-existent user must fail
    let catchErr: any;
    try {
      await prisma.fishCatch.create({
        data: {
          userId: 'non_existent_user_uuid',
          species: 'BASS',
          weightLbs: 3.5,
          coinsEarned: 25,
        },
      });
    } catch (e) {
      catchErr = e;
    }
    expect(catchErr).toBeDefined();
    expect(catchErr.code).toBe('P2003');
  });

  it('should have all 25+ expected tables in the havenworld_test schema after migrations', async () => {
    const result = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    const tableNames = result.map((r) => r.table_name);
    const expectedTables = [
      'users',
      'avatars',
      'rooms',
      'room_furniture',
      'items',
      'inventories',
      'chat_messages',
      'friends',
      'reports',
      'invite_codes',
      'fish_catches',
      'fishing_leaderboards',
      'room_decorators',
      'room_access_logs',
      'guestbook_entries',
      'tip_transactions',
      'trade_logs',
      'daily_login_streaks',
      'gift_transactions',
      'pets',
      'minigame_sessions',
      'weekly_earnings_caps',
      'material_inventories',
      'crafting_queues',
      'achievements',
      'passport_frames',
      'seasonal_events',
      'seasonal_progress',
      'clubs',
      'club_members',
      'daily_quest_progress',
      'gallery_photos',
      'photo_likes',
    ];

    for (const table of expectedTables) {
      expect(tableNames).toContain(table);
    }
    expect(tableNames.length).toBeGreaterThanOrEqual(25);
  });

  it('should have default seeded rooms in the database', async () => {
    const defaultRooms = await prisma.room.findMany({ where: { isPublic: true } });
    expect(defaultRooms.length).toBeGreaterThan(0);

    const townSquare = defaultRooms.find((r) => r.name === 'Town Square');
    expect(townSquare).toBeDefined();

    const park = defaultRooms.find((r) => r.name === 'Haven Park');
    expect(park).toBeDefined();
  });
});
