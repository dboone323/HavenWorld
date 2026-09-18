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
    // Furniture (starter set for personal rooms)
    { id: 'furniture-chair', name: 'Basic Chair', category: ItemCategory.FURNITURE, spriteKey: 'furniture/chair-basic', rarity: ItemRarity.COMMON },
    { id: 'furniture-table', name: 'Basic Table', category: ItemCategory.FURNITURE, spriteKey: 'furniture/table-basic', rarity: ItemRarity.COMMON },
    { id: 'furniture-plant', name: 'Small Plant', category: ItemCategory.FURNITURE, spriteKey: 'furniture/plant-small', rarity: ItemRarity.COMMON },
    { id: 'furniture-rug', name: 'Basic Rug', category: ItemCategory.FURNITURE, spriteKey: 'furniture/rug-basic', rarity: ItemRarity.COMMON },
    { id: 'furniture-lamp', name: 'Floor Lamp', category: ItemCategory.FURNITURE, spriteKey: 'furniture/lamp-floor', rarity: ItemRarity.COMMON },
  ];

  for (const item of defaultItems) {
    await prisma.item.upsert({
      where: { id: item.id },
      create: { ...item, isTradeable: false },
      update: { name: item.name },
    });
  }
  console.log(`[Seed] Created ${defaultItems.length} default items`);
  console.log('[Seed] Database seed complete!');
}

main()
  .catch((err) => {
    console.error('[Seed] Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
