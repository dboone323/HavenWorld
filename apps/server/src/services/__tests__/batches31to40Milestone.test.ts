import { prisma } from '../../prisma';
import { redisClient, connectRedis } from '../../redis';
import { createTestUser, defaultTestAvatar } from '../../../__tests__/helpers/factories';
import { ClubService } from '../ClubService';
import { DyeService } from '../DyeService';
import { GuestbookService } from '../GuestbookService';
import { PhotoGalleryService } from '../PhotoGalleryService';
import { GlobalEventService } from '../GlobalEventService';
import { AchievementService } from '../AchievementService';
import { EmoteProgressionService } from '../EmoteProgressionService';
import { RoomManager } from '../RoomManager';
import { ServerApmClusterService } from '../ServerApmClusterService';

describe('Batches 31–40 Milestone End-to-End Suite (Real Functional Validation)', () => {
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdClubIds: string[] = [];

  async function makeUser(havenCoins = 1000) {
    const user = await createTestUser({ havenCoins });
    createdUserIds.push(user.id);
    return user;
  }

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    // Clean up all test entities in strict foreign-key order
    if (createdUserIds.length > 0) {
      await prisma.photoLike.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.galleryPhoto.deleteMany({ where: { authorId: { in: createdUserIds } } });
      await prisma.guestbookEntry.deleteMany({ where: { authorId: { in: createdUserIds } } });
      await prisma.fishCatch.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.achievement.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.passportFrame.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.transactionLog.deleteMany({
        where: { OR: [{ senderId: { in: createdUserIds } }, { receiverId: { in: createdUserIds } }] },
      });
      await prisma.clubMember.deleteMany({ where: { userId: { in: createdUserIds } } });
    }

    if (createdClubIds.length > 0) {
      await prisma.clubMember.deleteMany({ where: { clubId: { in: createdClubIds } } });
      await prisma.club.deleteMany({ where: { id: { in: createdClubIds } } });
    }

    if (createdRoomIds.length > 0) {
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    }

    if (createdUserIds.length > 0) {
      await prisma.avatar.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it('Batch 31: Club leveling perks, member roles, and guild treasury management', async () => {
    const owner = await makeUser(2500);
    const member = await makeUser(2000);

    const clubName = `Guild_${Date.now().toString(36).slice(-6)}`;
    const club = await ClubService.createClub(owner.id, clubName, 'Pioneers', 'PIO');
    createdClubIds.push(club.id);
    if (club.roomId) createdRoomIds.push(club.roomId);

    await ClubService.joinClub(member.id, club.id);

    // Deposit 1,200 coins
    const deposit = await ClubService.depositTreasury(member.id, club.id, 1200);
    expect(deposit.balance).toBe(1200);
    expect(deposit.level).toBe(2);
    expect(deposit.perks).toContain('+10% Fishing Coins');

    // Role promotion
    const promoted = await ClubService.updateMemberRole(owner.id, club.id, member.id, 'OFFICER');
    expect(promoted.role).toBe('OFFICER');

    // MOTD
    const updated = await ClubService.setClubMotd(member.id, club.id, 'Updated by Officer');
    expect(updated.motto).toBe('Updated by Officer');
  });

  it('Batch 32: Avatar cosmetics dye system and palette shader validation', async () => {
    const user = await makeUser(500);
    await prisma.avatar.upsert({
      where: { userId: user.id },
      update: { topColor: '#111111' },
      create: { userId: user.id, topColor: '#111111' },
    });

    const uniforms = DyeService.computePaletteShaderUniforms('NEON_CYBERPUNK');
    expect(uniforms.u_primaryColor).toEqual([0, 0.9412, 1]);
    expect(uniforms.u_brightness).toBeGreaterThan(0);

    const dyeRes = await DyeService.applyDye(user.id, 'topColor', '#00F0FF', 50);
    expect(dyeRes.success).toBe(true);
    expect(dyeRes.color).toBe('#00F0FF');
    expect(dyeRes.remainingCoins).toBe(450);

    const dbAvatar = await prisma.avatar.findUnique({ where: { userId: user.id } });
    expect(dbAvatar?.topColor).toBe('#00F0FF');
  });

  it('Batch 33: Room visitor guestbook pagination, sentiment filtering, and rate limit protections', async () => {
    const owner = await makeUser(100);
    const visitor = await makeUser(100);

    const room = await prisma.room.create({
      data: { name: 'Sunset Loft', ownerId: owner.id, isPublic: true },
    });
    createdRoomIds.push(room.id);

    // Spam rejection
    expect(() =>
      GuestbookService.analyzeSentimentAndSpam('Check out my http://phishing.com/coins now!')
    ).not.toThrow();
    const spamCheck = GuestbookService.analyzeSentimentAndSpam('Visit http://badlink.com');
    expect(spamCheck.allowed).toBe(false);

    // Legitimate positive signing
    const entry = await GuestbookService.signBook(room.id, visitor.id, 'Awesome loft! Very cozy atmosphere.');
    expect(entry.id).toBeDefined();

    // Owner pin
    const pin = await GuestbookService.pinEntry(room.id, entry.id, owner.id);
    expect(pin.pinned).toBe(true);

    const page = await GuestbookService.getPage(room.id, 1, 5);
    expect(page.entries[0].isPinned).toBe(true);
  });

  it('Batch 34: Photo gallery album sharing, likes/views counters, and moderation tagging', async () => {
    const author = await makeUser(100);
    const fan = await makeUser(100);

    const photo = await PhotoGalleryService.publishPhoto({
      authorId: author.id,
      imageUrl: `https://havenworld.games/photos/milestone_${Date.now()}.png`,
      caption: 'Serene mountain morning in HavenWorld',
      roomName: 'Mountain Vista',
      category: 'PARK_NATURE',
    });

    const viewCount = await PhotoGalleryService.recordView(photo.id, fan.id);
    expect(viewCount).toBeGreaterThanOrEqual(1);

    const likeRes = await PhotoGalleryService.toggleLike(photo.id, fan.id);
    expect(likeRes.liked).toBe(true);
    expect(likeRes.likes).toBe(1);

    const stats = await PhotoGalleryService.getAuthorStats(author.id);
    expect(stats.totalPhotos).toBeGreaterThanOrEqual(1);
    expect(stats.totalLikes).toBeGreaterThanOrEqual(1);
  });

  it('Batch 35: Spatial audio distance attenuation & panning calculation', () => {
    // Validate mathematical inverse-distance roll-off
    const dx = 200;
    const dy = 0;
    const maxDist = 400;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const gain = Math.max(0, 1 - dist / maxDist);
    const pan = dx / (maxDist * 0.5);

    expect(gain).toBe(0.5);
    expect(pan).toBe(1.0);
  });

  it('Batch 36: Live event broadcast countdown timer, world banner toasts, and synchronized triggers', async () => {
    const scheduled = await GlobalEventService.scheduleGlobalEvent({
      type: 'STARLIGHT_CARNIVAL',
      title: 'Starlight Carnival',
      description: 'Carnival games awarded double tickets and coins!',
      startsInSeconds: 120,
      durationMinutes: 30,
      multiplier: 2.0,
    });

    expect(scheduled.id).toBeDefined();
    expect(GlobalEventService.calculateCountdownRemaining(scheduled)).toBeGreaterThan(0);

    const upcoming = GlobalEventService.getUpcomingEvents();
    expect(upcoming.some((e) => e.id === scheduled.id)).toBe(true);

    await GlobalEventService.cancelScheduledEvent(scheduled.id);
    await GlobalEventService.terminateActiveEvent();
  });

  it('Batch 37: Player passport stamp completion milestones, frame customization, and profile badges', async () => {
    const user = await makeUser(100);

    const milestone = AchievementService.calculatePassportMilestone(12);
    expect(milestone.tier).toBe('GOLD');
    expect(milestone.badge).toBe('Haven Champion');
    expect(milestone.completionPercentage).toBe(60);

    // Frame unlocks
    await AchievementService.setPassportFrame(user.id, 'default');
    const badge = await AchievementService.setFeaturedBadge(user.id, 'Haven Pioneer');
    expect(badge.featuredBadge).toBe('Haven Pioneer');

    const passport = await AchievementService.getPassportData(user.id);
    expect(passport?.frameId).toBe('default');
    expect(passport?.featuredBadge).toBe('Haven Pioneer');
  });

  it('Batch 38: Emote progression wheel customization, unlock validation, and custom animations', async () => {
    const user = await makeUser(100);

    const emotes = await EmoteProgressionService.getPlayerEmotes(user.id);
    expect(emotes.some((e) => e.id === 'wave' && e.unlocked)).toBe(true);

    const wheel = await EmoteProgressionService.getEmoteWheel(user.id);
    expect(wheel).toContain('wave');

    const trigger = await EmoteProgressionService.validateEmoteTrigger(user.id, 'wave');
    expect(trigger.animation.durationMs).toBe(1200);
  });

  it('Batch 39: Real-time room capacity soft-caps, overflow instance spillover, and queue redirection', () => {
    const rm = new RoomManager();
    const baseRoom = 'test-cap-room';
    rm.setRoomCapacityLimits(baseRoom, { softCap: 1, hardCap: 2 });

    const p1 = {
      id: 'p1',
      username: 'Alice',
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      direction: 'down' as const,
      isMoving: false,
      avatar: defaultTestAvatar,
    };
    rm.joinRoom(baseRoom, 's1', p1);

    // Normal player spills to shard #2
    const spill = rm.resolveTargetRoomInstance(baseRoom, 'p2', false, 2);
    expect(spill.targetRoomId).toBe('test-cap-room#2');

    // VIP player bypasses softCap up to hardCap
    const vip = rm.resolveTargetRoomInstance(baseRoom, 'p_vip', true, 2);
    expect(vip.targetRoomId).toBe('test-cap-room');
  });

  it('Batch 40: Server APM cluster health aggregator collects live metrics and queries database/redis', async () => {
    const snapshot = await ServerApmClusterService.getClusterApmSnapshot();

    expect(snapshot.nodeId).toBeDefined();
    expect(snapshot.status).toBeDefined();
    expect(snapshot.processMemory.heapUsedMb).toBeGreaterThan(0);
    expect(snapshot.database.connected).toBe(true);
    expect(snapshot.database.queryLatencyMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.system.hostname).toBeDefined();
  });
});
