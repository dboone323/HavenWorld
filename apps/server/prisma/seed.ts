import { PrismaClient, ItemCategory, ItemRarity } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Starting database seed...');

  // ── 1. Public Rooms ────────────────────────────────────────────────────────
  console.log('[Seed] Creating public rooms...');
  const publicRooms = [
    {
      id: 'room-lobby',
      name: 'The Lobby',
      description: 'The main gathering place for all HavenWorld visitors.',
      isPublic: false,
      maxOccupants: 50,
      width: 20,
      height: 15,
      backgroundKey: 'map-lobby',
      theme: 'lobby',
    },
    {
      id: 'room-town-square',
      name: 'Town Square',
      description: 'The heart of HavenWorld — meet friends and explore.',
      isPublic: false,
      maxOccupants: 100,
      width: 30,
      height: 20,
      backgroundKey: 'map-town-square',
      theme: 'outdoor',
    },
    {
      id: 'room-park',
      name: 'Haven Park',
      description: 'A serene community park with trees, benches, and a water spot for fishing.',
      isPublic: true,
      maxOccupants: 100,
      width: 25,
      height: 18,
      backgroundKey: 'map-park',
      theme: 'outdoor',
    },
    {
      id: 'room-cafe',
      name: 'The Cozy Café',
      description: 'Grab a virtual coffee and catch up with friends.',
      isPublic: false,
      maxOccupants: 30,
      width: 15,
      height: 12,
      backgroundKey: 'map-cafe',
      theme: 'indoor',
    },
  ];

  for (const room of publicRooms) {
    await prisma.room.upsert({
      where: { id: room.id },
      create: room,
      update: {
        name: room.name,
        description: room.description,
        isPublic: room.isPublic,
      },
    });
  }
  console.log(`[Seed] Created ${publicRooms.length} public rooms`);

  // ── 2. Default Free Items ───────────────────────────────────────────────────
  console.log('[Seed] Creating default free items...');
  const defaultItems = [
    // Hair
    { id: 'hair-short-01', name: 'Short Hair', category: ItemCategory.HAIR, spriteKey: 'hair/hair-short-01', rarity: ItemRarity.COMMON },
    { id: 'hair-short-02', name: 'Short Alt Hair', category: ItemCategory.HAIR, spriteKey: 'hair/hair-short-02', rarity: ItemRarity.COMMON },
    { id: 'hair-long-01', name: 'Long Hair', category: ItemCategory.HAIR, spriteKey: 'hair/hair-long-01', rarity: ItemRarity.COMMON },
    // Eyes
    { id: 'eyes-default', name: 'Default Eyes', category: ItemCategory.EYES, spriteKey: 'eyes/eyes-default', rarity: ItemRarity.COMMON },
    { id: 'eyes-round', name: 'Round Eyes', category: ItemCategory.EYES, spriteKey: 'eyes/eyes-round', rarity: ItemRarity.COMMON },
    // Tops
    { id: 'shirt-white', name: 'White Shirt', category: ItemCategory.CLOTHING_BODY, spriteKey: 'clothing/shirt-white', rarity: ItemRarity.COMMON },
    { id: 'shirt-black', name: 'Black Shirt', category: ItemCategory.CLOTHING_BODY, spriteKey: 'clothing/shirt-black', rarity: ItemRarity.COMMON },
    { id: 'shirt-blue', name: 'Blue Shirt', category: ItemCategory.CLOTHING_BODY, spriteKey: 'clothing/shirt-blue', rarity: ItemRarity.COMMON },
    // Bottoms
    { id: 'pants-blue', name: 'Blue Jeans', category: ItemCategory.CLOTHING_LEGS, spriteKey: 'clothing/pants-blue', rarity: ItemRarity.COMMON },
    { id: 'pants-black', name: 'Black Pants', category: ItemCategory.CLOTHING_LEGS, spriteKey: 'clothing/pants-black', rarity: ItemRarity.COMMON },
    // Feet
    { id: 'shoes-white', name: 'White Sneakers', category: ItemCategory.CLOTHING_FEET, spriteKey: 'clothing/shoes-white', rarity: ItemRarity.COMMON },
    { id: 'shoes-black', name: 'Black Shoes', category: ItemCategory.CLOTHING_FEET, spriteKey: 'clothing/shoes-black', rarity: ItemRarity.COMMON },
    // Furniture (Part 5B 10 items)
    { id: 'furniture-chair', name: 'Wooden Chair', category: ItemCategory.FURNITURE, spriteKey: 'chair', assetUrl: '/assets/furniture/chair.glb', price: 0, isDefault: true, description: 'A simple wooden chair. Comfortable enough.' },
    { id: 'furniture-table', name: 'Round Table', category: ItemCategory.FURNITURE, spriteKey: 'table', assetUrl: '/assets/furniture/table.glb', price: 0, isDefault: true, description: 'A round wooden table. Fits four chairs.' },
    { id: 'furniture-sofa', name: 'Blue Sofa', category: ItemCategory.FURNITURE, spriteKey: 'sofa', assetUrl: '/assets/furniture/sofa.glb', price: 0, isDefault: true, description: 'A comfortable two-seater sofa in ocean blue.' },
    { id: 'furniture-lamp', name: 'Floor Lamp', category: ItemCategory.FURNITURE, spriteKey: 'lamp', assetUrl: '/assets/furniture/lamp.glb', price: 0, isDefault: true, description: 'A tall floor lamp with a warm white shade.' },
    { id: 'furniture-bookshelf', name: 'Bookshelf', category: ItemCategory.FURNITURE, spriteKey: 'bookshelf', assetUrl: '/assets/furniture/bookshelf.glb', price: 0, isDefault: true, description: 'A wooden bookshelf. Perfect for the intellectual look.' },
    { id: 'furniture-rug', name: 'Red Rug', category: ItemCategory.FURNITURE, spriteKey: 'rug', assetUrl: '/assets/furniture/rug.glb', price: 0, isDefault: true, description: 'A classic red area rug. Ties the room together.' },
    { id: 'furniture-painting', name: 'Wall Painting', category: ItemCategory.FURNITURE, spriteKey: 'painting', assetUrl: '/assets/furniture/painting.glb', price: 100, isDefault: false, description: 'An abstract painting to brighten up your walls.' },
    { id: 'furniture-fireplace', name: 'Fireplace', category: ItemCategory.FURNITURE, spriteKey: 'fireplace', assetUrl: '/assets/furniture/fireplace.glb', price: 250, isDefault: false, description: 'A cozy decorative fireplace. Crackling not included.' },
    { id: 'furniture-plant', name: 'Plant Pot', category: ItemCategory.FURNITURE, spriteKey: 'plant', assetUrl: '/assets/furniture/plant.glb', price: 50, isDefault: false, description: 'A leafy green houseplant in a terracotta pot.' },
    { id: 'furniture-tv', name: 'TV Stand', category: ItemCategory.FURNITURE, spriteKey: 'tv', assetUrl: '/assets/furniture/tv.glb', price: 200, isDefault: false, description: 'A sleek TV stand. Screen sold separately.' },
  ];

  for (const item of defaultItems) {
    await prisma.item.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        name: item.name,
        description: item.description || '',
        category: item.category,
        rarity: (item as any).rarity || ItemRarity.COMMON,
        spriteKey: item.spriteKey,
        assetUrl: (item as any).assetUrl,
        price: (item as any).price ?? 0,
        isDefault: (item as any).isDefault ?? false,
        isTradeable: false,
      },
      update: {
        name: item.name,
        description: item.description || '',
        spriteKey: item.spriteKey,
        assetUrl: (item as any).assetUrl,
        price: (item as any).price ?? 0,
        isDefault: (item as any).isDefault ?? false,
      },
    });
  }
  console.log(`[Seed] Upserted ${defaultItems.length} items`);

  // Grant all isDefault furniture items to all users
  const defaultFurniture = await prisma.item.findMany({
    where: { category: ItemCategory.FURNITURE, isDefault: true },
  });
  const allUsers = await prisma.user.findMany({ select: { id: true } });
  for (const user of allUsers) {
    for (const item of defaultFurniture) {
      await prisma.inventory.upsert({
        where: { userId_itemId: { userId: user.id, itemId: item.id } },
        create: { userId: user.id, itemId: item.id, quantity: 1 },
        update: {},
      });
    }
  }
  console.log(`[Seed] Granted default furniture to ${allUsers.length} users.`);
  console.log('[Seed] Database seed complete!');
}

main()
  .catch((err) => {
    console.error('[Seed] Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
