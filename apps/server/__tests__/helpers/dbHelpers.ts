import { prisma } from '../../src/prisma';

/**
 * TRUNCATES all application tables in the test database in an FK-safe order.
 * Uses RESTART IDENTITY to reset sequences and CASCADE to handle dependencies.
 */
export async function truncateAllTables(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.includes('_test')) {
    throw new Error('SAFETY: truncateAllTables must only run against havenworld_test');
  }

  // Truncate all application tables using actual mapped table names
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "photo_likes",
      "gallery_photos",
      "daily_quest_progress",
      "club_members",
      "clubs",
      "seasonal_progress",
      "seasonal_events",
      "passport_frames",
      "achievements",
      "crafting_queues",
      "material_inventories",
      "weekly_earnings_caps",
      "minigame_sessions",
      "pets",
      "gift_transactions",
      "daily_login_streaks",
      "trade_logs",
      "tip_transactions",
      "guestbook_entries",
      "room_access_logs",
      "room_decorators",
      "fishing_leaderboards",
      "fish_catches",
      "room_furniture",
      "chat_messages",
      "friends",
      "reports",
      "invite_codes",
      "inventories",
      "avatars",
      "rooms",
      "items",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

/**
 * Seeds minimal data required for tests: default rooms and starter items.
 */
export async function seedMinimalData(): Promise<void> {
  // Create system user if needed for rooms
  const systemUser = await prisma.user.upsert({
    where: { username: 'havenworld_system' },
    create: {
      id: 'system-user-uuid',
      email: 'system@havenworld.local',
      username: 'havenworld_system',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      emailVerified: true,
      role: 'ADMIN',
    },
    update: {},
  });

  // Seed default rooms
  await prisma.room.upsert({
    where: { id: 'room-town-square' },
    create: {
      id: 'room-town-square',
      name: 'Town Square',
      privacy: 'PUBLIC',
      isPublic: true,
      maxOccupants: 50,
      theme: 'town_square',
      ownerId: systemUser.id,
    },
    update: {},
  });

  await prisma.room.upsert({
    where: { id: 'room-park' },
    create: {
      id: 'room-park',
      name: 'Haven Park',
      privacy: 'PUBLIC',
      isPublic: true,
      maxOccupants: 50,
      theme: 'park',
      ownerId: systemUser.id,
    },
    update: {},
  });

  await prisma.room.upsert({
    where: { id: 'room-fishing-dock' },
    create: {
      id: 'room-fishing-dock',
      name: 'Fishing Dock',
      privacy: 'PUBLIC',
      isPublic: true,
      maxOccupants: 20,
      theme: 'fishing_dock',
      ownerId: systemUser.id,
    },
    update: {},
  });

  // Seed starter items
  const defaultFreeItems: Array<{ id: string; name: string; category: any; spriteKey: string }> = [
    { id: 'hair-short-01', name: 'Short Hair 01', category: 'HAIR', spriteKey: 'hair-short-01' },
    { id: 'hair-short-02', name: 'Short Hair 02', category: 'HAIR', spriteKey: 'hair-short-02' },
    { id: 'hair-long-01', name: 'Long Hair 01', category: 'HAIR', spriteKey: 'hair-long-01' },
    { id: 'eyes-default', name: 'Default Eyes', category: 'EYES', spriteKey: 'eyes-default' },
    { id: 'eyes-round', name: 'Round Eyes', category: 'EYES', spriteKey: 'eyes-round' },
    { id: 'shirt-white', name: 'White Shirt', category: 'CLOTHING_BODY', spriteKey: 'shirt-white' },
    { id: 'shirt-black', name: 'Black Shirt', category: 'CLOTHING_BODY', spriteKey: 'shirt-black' },
    { id: 'shirt-blue', name: 'Blue Shirt', category: 'CLOTHING_BODY', spriteKey: 'shirt-blue' },
    { id: 'pants-blue', name: 'Blue Pants', category: 'CLOTHING_LEGS', spriteKey: 'pants-blue' },
    { id: 'pants-black', name: 'Black Pants', category: 'CLOTHING_LEGS', spriteKey: 'pants-black' },
    { id: 'shoes-white', name: 'White Shoes', category: 'CLOTHING_FEET', spriteKey: 'shoes-white' },
    { id: 'shoes-black', name: 'Black Shoes', category: 'CLOTHING_FEET', spriteKey: 'shoes-black' },
    { id: 'furniture-chair', name: 'Starter Chair', category: 'FURNITURE', spriteKey: 'furniture-chair' },
    { id: 'furniture-table', name: 'Starter Table', category: 'FURNITURE', spriteKey: 'furniture-table' },
    { id: 'furniture-plant', name: 'Starter Plant', category: 'DECORATION', spriteKey: 'furniture-plant' },
    { id: 'furniture-rug', name: 'Starter Rug', category: 'DECORATION', spriteKey: 'furniture-rug' },
    { id: 'furniture-lamp', name: 'Starter Lamp', category: 'FURNITURE', spriteKey: 'furniture-lamp' },
  ];

  for (const item of defaultFreeItems) {
    await prisma.item.upsert({
      where: { name: item.name },
      create: {
        id: item.id,
        name: item.name,
        category: item.category,
        price: 0,
        spriteKey: item.spriteKey,
        isDefault: true,
      },
      update: {},
    });
  }

  await prisma.item.upsert({
    where: { name: 'Basic Chair' },
    create: {
      id: 'item-basic-chair',
      name: 'Basic Chair',
      category: 'FURNITURE',
      price: 100,
      spriteKey: 'chair',
      assetUrl: '/assets/furniture/chair.glb',
    },
    update: {},
  });

  await prisma.item.upsert({
    where: { name: 'Cozy Lamp' },
    create: {
      id: 'item-cozy-lamp',
      name: 'Cozy Lamp',
      category: 'FURNITURE',
      price: 150,
      spriteKey: 'lamp',
      assetUrl: '/assets/furniture/lamp.glb',
    },
    update: {},
  });

  await prisma.item.upsert({
    where: { name: 'HavenWorld Hoodie' },
    create: {
      id: 'item-hoodie',
      name: 'HavenWorld Hoodie',
      category: 'CLOTHING_BODY',
      price: 500,
      spriteKey: 'hoodie',
    },
    update: {},
  });
}
