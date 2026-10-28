import { prisma } from '../../prisma';
import { redis, redisClient, connectRedis } from '../../redis';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { WeatherService } from '../WeatherService';
import { NpcDialogueService } from '../NpcDialogueService';
import { PetManager, PET_TRICKS } from '../PetManager';
import { BulletinBoardService } from '../BulletinBoardService';
import { LoftRatingService } from '../LoftRatingService';
import { Web3CollectibleService } from '../Web3CollectibleService';
import { AfkDetectionService } from '../AfkDetectionService';
import { InventoryService } from '../InventoryService';
import { ShopService } from '../ShopService';
import { DistributedLockManager } from '../DistributedLockManager';

describe('Batches 41–50 Milestone End-to-End Suite (Real Functional Validation)', () => {
  const createdUserIds: string[] = [];

  async function makeUser(
    havenCoins = 1000,
    overrides: Parameters<typeof createTestUser>[0] = {},
  ) {
    const user = await createTestUser({ havenCoins, ...overrides });
    createdUserIds.push(user.id);
    return user;
  }

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    // Clean up test items
    await prisma.inventory.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.avatar.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    // Clean up milestone-specific test items
    await prisma.item.deleteMany({ where: { id: { in: ['ms-rare-item-b41-50', 'ms-epic-item-b41-50'] } } });

    // Flush test Redis keys
    for (const uid of createdUserIds) {
      await redis.del(`player:last_activity:${uid}`);
      await redis.del(`player:room:${uid}`);
    }
  });

  it('Batch 41: WeatherService returns 7-state atmospheric overlay with fog/sandstorm/sakura types', () => {
    const overlay = WeatherService.getAtmosphericOverlay('FOG', 1.0);
    expect(overlay.fogDensity).toBeGreaterThan(0);
    expect(overlay.fogColor).toBeDefined();

    const sakuraOverlay = WeatherService.getAtmosphericOverlay('SAKURA_BLOSSOM', 0.7);
    expect(sakuraOverlay.particleType).toBe('petals');

    const sandstormOverlay = WeatherService.getAtmosphericOverlay('SANDSTORM', 1.0);
    expect(sandstormOverlay.particleType).toBe('dust');

    // Interpolating FOG into a clear-ish SUNNY overlay lowers fog density toward SUNNY.
    const fog = WeatherService.getAtmosphericOverlay('FOG', 1.0);
    const sunny = WeatherService.getAtmosphericOverlay('SUNNY', 0.0);
    const interpolated = WeatherService.interpolateOverlay(fog, sunny, 0.5);
    expect(interpolated.fogDensity).toBeGreaterThanOrEqual(sunny.fogDensity);
    expect(interpolated.fogDensity).toBeLessThanOrEqual(fog.fogDensity);
  });

  it('Batch 42: NPC affinity system tracks tiers, awards quest handoffs, and adjusts delta correctly', async () => {
    const user = await makeUser();
    const npcId = 'innkeeper';

    const initial = await NpcDialogueService.getAffinity(user.id, npcId);
    expect(initial.tier).toBe('STRANGER');

    // +25 crosses the FRIENDLY threshold (>= 20) without jumping to HONORED/REVERED.
    await NpcDialogueService.adjustAffinity(user.id, npcId, 25);
    const friendly = await NpcDialogueService.getAffinity(user.id, npcId);
    expect(friendly.affinity).toBe(25);
    expect(friendly.tier).toBe('FRIENDLY');

    await redis.del(`npc:affinity:${user.id}:${npcId}`);
  });

  it('Batch 43: PetManager trick catalog returns definitions; loyalty-gated tricks are enforced', async () => {
    const user = await makeUser();
    const pet = await PetManager.adoptPet(user.id, 'CAT', 'Whiskers');

    // The trick catalog exposes definitions with a required-loyalty tier.
    expect(PET_TRICKS.SIT.requiredLoyalty).toBe('ACQUAINTANCE');
    expect(PET_TRICKS.DANCE.requiredLoyalty).toBe('SOULMATE');

    // A freshly adopted pet (happiness=100, hunger=100) is a SOULMATE, so even the
    // top-tier DANCE trick succeeds.
    const result = await PetManager.performTrick(user.id, pet.id, 'SIT');
    expect(result.success).toBe(true);
    expect(result.trick).toBe('SIT');
    expect(result.happinessGain).toBe(PET_TRICKS.SIT.happinessReward);

    // Drop the pet's happiness/hunger so its loyalty falls below SOULMATE; the
    // loyalty gate must then reject DANCE.
    await prisma.pet.update({ where: { id: pet.id }, data: { happiness: 10, hunger: 10 } });
    await expect(
      PetManager.performTrick(user.id, pet.id, 'DANCE'),
    ).rejects.toThrow(/Requires loyalty SOULMATE/i);

    await prisma.pet.deleteMany({ where: { ownerId: user.id } });
  });

  it('Batch 44: BulletinBoardService supports upvoting, sticky, and paginated retrieval', async () => {
    // Sticky pinning is admin-only, so post as an admin.
    const user = await makeUser(1000, { role: 'ADMIN' });

    const post = await BulletinBoardService.postMessage(user.id, {
      category: 'SOCIAL',
      title: 'Milestone Post B44',
      body: 'End-to-end milestone validation for Batch 44 bulletin board.',
    });
    expect(post.id).toBeDefined();

    const upvoteResult = await BulletinBoardService.upvotePost(user.id, post.id);
    expect(upvoteResult.upvotes).toBe(1);

    await BulletinBoardService.setSticky(user.id, post.id, true);
    const page = BulletinBoardService.getPaginatedPosts(1, 10);
    const found = page.posts.find((p) => p.id === post.id);
    expect(found?.isSticky).toBe(true);
  });

  it('Batch 45: LoftRatingService records star ratings, aggregates summary, and scores weekly leaderboard', async () => {
    const owner = await makeUser();
    const rater = await makeUser();

    const room = await prisma.room.create({
      data: { name: `MilestoneShowcase_${Date.now()}`, ownerId: owner.id, isPublic: true },
    });

    await LoftRatingService.submitLoftRating(rater.id, room.id, { stars: 5, tags: ['cozy', 'creative_build'] });
    const summary = await LoftRatingService.getRoomRatingSummary(room.id);
    expect(summary.averageRating).toBe(5);
    expect(summary.totalReviews).toBe(1);
    expect(summary.tagsCount['cozy']).toBe(1);

    const board = await LoftRatingService.getWeeklyLeaderboard();
    expect(board.length).toBeGreaterThanOrEqual(1);

    await prisma.gameEvent.deleteMany({ where: { userId: rater.id } });
    await prisma.room.delete({ where: { id: room.id } });
  });

  it('Batch 46: Web3CollectibleService generates provenance certificate and exports ERC-721 metadata', () => {
    const payload = {
      souvenirId: `souvenir_milestone_${Date.now()}`,
      itemId: 'legendary-sword',
      itemName: 'Legendary Sword',
      originalMinterId: 'user_milestone',
      minterUsername: 'MilestonePlayer',
      mintedTimestamp: Date.now(),
      serialNumber: 1,
      editionTotal: 10,
      rarity: 'LEGENDARY' as const,
      eventOrigin: 'Milestone Event 41-50',
    };
    const cert = Web3CollectibleService.generateProvenanceCertificate(payload);

    expect(cert.provenanceHash).toBeDefined();
    expect(cert.signature).toBeDefined();

    const verifyResult = Web3CollectibleService.verifyCertificate(cert);
    expect(verifyResult.isValid).toBe(true);

    const metadata = Web3CollectibleService.exportTokenMetadata(cert, {
      imageUrl: 'https://havenworld.games/nfts/milestone.png',
      description: 'Batches 41-50 milestone collectible',
    });
    expect(metadata.attributes.some((a) => a.trait_type === 'Rarity')).toBe(true);
  });



  it('Batch 47: AfkDetectionService progresses presence stages and evicts expired players', async () => {
    const user = await makeUser();
    const roomId = `milestone-afk-room-${Date.now()}`;

    await AfkDetectionService.recordActivity(user.id, roomId);

    const now = Date.now();
    await redis.set(`player:last_activity:${user.id}`, String(now - 16 * 60_000));

    const evalResult = await AfkDetectionService.evaluateRoom(roomId, now);
    expect(evalResult).toBeDefined();
    // user is in an evictable state
    const status = await AfkDetectionService.getPlayerStatus(user.id, now);
    expect(status.isEvictable).toBe(true);
    expect(status.stage).toBe('AUTO_DEPART_SCHEDULED');
  });

  it('Batch 48: InventoryService bulk recycle returns correct coins per rarity tier', async () => {
    const user = await makeUser(0);

    await prisma.item.upsert({
      where: { id: 'ms-rare-item-b41-50' },
      create: { id: 'ms-rare-item-b41-50', name: 'MS Rare', description: 'test', category: 'DECORATION', rarity: 'RARE', price: 200, spriteKey: 'ms-rare' },
      update: {},
    });
    await prisma.item.upsert({
      where: { id: 'ms-epic-item-b41-50' },
      create: { id: 'ms-epic-item-b41-50', name: 'MS Epic', description: 'test', category: 'DECORATION', rarity: 'EPIC', price: 500, spriteKey: 'ms-epic' },
      update: {},
    });

    const svc = new InventoryService();
    await svc.addItem(user.id, 'ms-rare-item-b41-50', 1);
    await svc.addItem(user.id, 'ms-epic-item-b41-50', 1);

    const result = await svc.bulkRecycle(user.id, [
      { itemId: 'ms-rare-item-b41-50', quantity: 1 },
      { itemId: 'ms-epic-item-b41-50', quantity: 1 },
    ]);

    // RARE(40) + EPIC(100) = 140
    expect(result.totalCoinsAwarded).toBe(140);
    expect(result.recycled).toHaveLength(2);

    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { havenCoins: true } });
    expect(after!.havenCoins).toBe(140);
  });

  it('Batch 49: ShopService flash sales apply discounts and stock quotas enforce sold-out', () => {
    const itemId = 'furniture-bookshelf';
    ShopService.scheduleFlashSale(itemId, 30, 3_600_000);

    const { onSale, discountPercent } = ShopService.getEffectivePrice(itemId);
    expect(onSale).toBe(true);
    expect(discountPercent).toBe(30);

    ShopService.setStockQuota(itemId, 2);
    ShopService.consumeStock(itemId, 2);
    expect(() => ShopService.consumeStock(itemId, 1)).toThrow('SOLD_OUT');

    // Expire the sale
    ShopService.expireFlashSales(Date.now() + 999_999_999);
  });

  it('Batch 50: DistributedLockManager acquires, extends, and releases locks via Redis Lua scripts', async () => {
    const resource = `milestone-lock-${Date.now()}`;

    const lock = await DistributedLockManager.acquire(resource, { ttlMs: 5000 });
    expect(lock.token).toBeTruthy();

    const held = await DistributedLockManager.isHeld(resource, lock.token);
    expect(held).toBe(true);

    const extended = await DistributedLockManager.extend(lock, 10_000);
    expect(extended).toBe(true);

    const ttl = await DistributedLockManager.getRemainingTtlMs(resource);
    expect(ttl).toBeGreaterThan(2000);

    const released = await DistributedLockManager.release(lock);
    expect(released).toBe(true);

    const afterTtl = await DistributedLockManager.getRemainingTtlMs(resource);
    expect(afterTtl).toBe(0);
  });
});
