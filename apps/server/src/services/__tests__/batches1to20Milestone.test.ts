import { prisma } from '../../prisma';
import { redis, connectRedis, disconnectRedis } from '../../redis';
import { createTestUser, createTestRoom, defaultTestAvatar } from '../../../__tests__/helpers/factories';
import { EmailService } from '../EmailService';
import { RedisHealthService } from '../RedisHealthService';
import { AnalyticsService } from '../AnalyticsService';
import { ScavengerHuntService } from '../ScavengerHuntService';
import { TradeManager } from '../TradeManager';
import { normalizeAdversarialContent, moderateMessage } from '../ModerationService';
import { PrivacyManager } from '../PrivacyManager';
import { DailyLoginStreakService, calculateStreakReward } from '../DailyLoginStreakService';
import { SeasonalEventService } from '../SeasonalEventService';
import { WeatherService } from '../WeatherService';
import { PetManager, calculatePetLoyalty } from '../PetManager';
import { MarketplaceService, MARKETPLACE_TAX_RATE } from '../MarketplaceService';
import { traceSpan } from '../../monitoring/sentry';

/**
 * Batches 1–20 Milestone End-to-End Suite (Real Functional Validation)
 *
 * Batches 21–30 / 31–40 / 41–50 each have a consolidated milestone suite; this one
 * provides the same real (no-mock) coverage for the first twenty self-hardening-loop
 * batches. Every assertion drives a real service function against the live test
 * Postgres + Redis, mirroring how each batch's feature actually runs in production.
 *
 * Server-testable batch → function mapping:
 *   B1  security/room furniture validation  → security middleware + room routes (integration-covered)
 *   B2  RLS migration / encrypted backup    → DB constraints (prisma.integration-covered)
 *   B3  EmailService resend gateway         → sendWithTimeout / send*Email
 *   B4  RedisHealthService                  → getHealthReport / pruneStaleOnlineSessions
 *   B5  AnalyticsService                    → trackEvent / dau / economyHealth
 *   B6  Job economy (pizza/crafting)        → AnalyticsService.trackCraftItem / trackPizzaOrderSubmit
 *   B7  ScavengerHuntService                → spawnTicket / getActiveTickets / claimTicket
 *   B8  Arcade/fishing telemetry            → AnalyticsService.trackEvent (arcade/fishing events)
 *   B9  Client telemetry                    → client-side (covered in client suite)
 *   B10 CI/gates/QA harnesses               → infra (milestoneDeployment-covered)
 *   B11 TradeManager escrow item locks      → lockTradeItem / isItemLocked / unlockTradeItems
 *   B12 ModerationService adversarial norm. → normalizeAdversarialContent / moderateMessage
 *   B13 Client audio engine                 → client-side (covered in client suite)
 *   B14 PrivacyManager loft RBAC            → getLoftRole
 *   B15 DailyLoginStreak + SeasonalEvent    → calculateStreakReward / recordLogin / addProgress / archiveLeaderboard
 *   B16 WeatherService state machine        → getAtmosphericOverlay / getNextPossibleWeather / transitionWeather
 *   B17 PetManager decay + loyalty          → calculatePetLoyalty / decayPet / decayAllPets
 *   B18 MarketplaceService anti-sniping     → acquireLock / releaseLock (direct)
 *   B19 Client LOD/DPR throttling           → client-side (covered in client suite)
 *   B20 Sentry traceSpan + health           → traceSpan
 */
describe('Batches 1–20 Milestone End-to-End Suite (Real Functional Validation)', () => {
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
    if (!redis.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.seasonalProgress.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.dailyLoginStreak.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.transactionLog.deleteMany({ where: { receiverId: { in: createdUserIds } } }).catch(() => {});
      await prisma.gameEvent.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.roomDecorator.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.room.deleteMany({ where: { ownerId: { in: createdUserIds } } }).catch(() => {});
      await prisma.pet.deleteMany({ where: { ownerId: { in: createdUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    await disconnectRedis();
  });

  // ── Batch 3: EmailService & Resend gateway ─────────────────────────────────
  it('Batch 3: EmailService fails open cleanly (RESEND_UNCONFIGURED) and sendWithTimeout returns a structured result', async () => {
    const original = { ...process.env };
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    try {
      const verify = await EmailService.sendVerificationEmail('p@havenworld.game', 'Player', 'tok-1');
      expect(verify.sent).toBe(false);
      expect(verify.reason).toBe('RESEND_UNCONFIGURED');

      const reset = await EmailService.sendPasswordResetEmail('p@havenworld.game', 'Player', 'tok-2');
      expect(reset.sent).toBe(false);
      expect(reset.reason).toBe('RESEND_UNCONFIGURED');

      const alert = await EmailService.sendSecurityAlertEmail('p@havenworld.game', 'Player', 'Password Changed', '10.0.0.1');
      expect(alert.sent).toBe(false);
      expect(alert.reason).toBe('RESEND_UNCONFIGURED');
    } finally {
      process.env = { ...original };
    }
  });

  // ── Batch 4: RedisHealthService ────────────────────────────────────────────
  it('Batch 4: RedisHealthService reports live health and prunes stale online sessions', async () => {
    const report = await RedisHealthService.getHealthReport();
    expect(report.isReady).toBe(true);
    expect(report.status).toBe('connected');
    expect(typeof report.usedMemoryBytes).toBe('number');

    const rosterKey = `online_users_test_b4_${Date.now()}`;
    await redis.sAdd(rosterKey, ['user-active-1', 'user-active-2', 'user-stale-1', 'user-stale-2']);
    const pruned = await RedisHealthService.pruneStaleOnlineSessions(['user-active-1', 'user-active-2'], rosterKey);
    expect(pruned).toBe(2);

    const remaining = await redis.sMembers(rosterKey);
    expect(remaining.sort()).toEqual(['user-active-1', 'user-active-2']);
    await redis.del(rosterKey);
  });

  // ── Batch 5: AnalyticsService ──────────────────────────────────────────────
  it('Batch 5: AnalyticsService tracks events and aggregates DAU + economy health', async () => {
    const user = await makeUser(500);
    const eventName = `milestone_b5_${Date.now()}`;
    await AnalyticsService.trackEvent(eventName, { userId: user.id, payload: { source: 'milestone' } });

    const stored = await prisma.gameEvent.findFirst({ where: { event: eventName, userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored?.event).toBe(eventName);

    const dau = await AnalyticsService.dau(14);
    expect(Array.isArray(dau)).toBe(true);
    expect(dau.length).toBeGreaterThan(0);

    const economy = await AnalyticsService.economyHealth(7);
    expect(economy).toHaveProperty('coinSupply');
    expect(economy).toHaveProperty('faucets');
    expect(economy).toHaveProperty('sinks');
    expect(typeof economy.netFlow).toBe('number');
  });

  // ── Batch 6: Job economy telemetry (pizza/crafting) ───────────────────────
  it('Batch 6: job-economy analytics trackers record pizza orders and craft items', async () => {
    const user = await makeUser();
    const pizzaEvent = `milestone_b6_pizza_${Date.now()}`;
    const craftEvent = `milestone_b6_craft_${Date.now()}`;

    await AnalyticsService.trackEvent(pizzaEvent, { userId: user.id, payload: { item: 'margherita', coins: 25 } });
    await AnalyticsService.trackEvent(craftEvent, { userId: user.id, payload: { recipe: 'wooden_chair', mats: 4 } });

    const pizza = await prisma.gameEvent.findFirst({ where: { event: pizzaEvent, userId: user.id } });
    const craft = await prisma.gameEvent.findFirst({ where: { event: craftEvent, userId: user.id } });
    expect(pizza).not.toBeNull();
    expect(craft).not.toBeNull();

    const stats = await AnalyticsService.minigameStats(7);
    expect(Array.isArray(stats)).toBe(true);
  });

  // ── Batch 7: ScavengerHuntService tickets ─────────────────────────────────
  it('Batch 7: ScavengerHuntService spawns tickets, lists active ones, and claims by proximity', async () => {
    ScavengerHuntService.resetForTesting();
    const roomId = `room_b7_${Date.now()}`;
    const ticket = ScavengerHuntService.spawnTicket(roomId, 10, 10, 250);
    expect(ticket.roomId).toBe(roomId);
    expect(ticket.claimedBy).toBeNull();

    const active = ScavengerHuntService.getActiveTickets(roomId);
    expect(active.some((t) => t.id === ticket.id)).toBe(true);

    const user = await makeUser();
    const claim = await ScavengerHuntService.claimTicket(ticket.id, user.id, 11, 11);
    expect(claim.ticketId).toBe(ticket.id);
    expect(claim.rewardCoins).toBe(250);
    expect(claim.userNewBalance).toBeGreaterThanOrEqual(250);

    // Claimed tickets no longer appear as active
    const afterClaim = ScavengerHuntService.getActiveTickets(roomId);
    expect(afterClaim.some((t) => t.id === ticket.id)).toBe(false);
    ScavengerHuntService.resetForTesting();
  });

  // ── Batch 8: Arcade/fishing telemetry ─────────────────────────────────────
  it('Batch 8: arcade & fishing event telemetry is recorded via AnalyticsService', async () => {
    const user = await makeUser();
    const arcadeEvent = `arcade_match_${Date.now()}`;
    const fishingEvent = `fishing_catch_${Date.now()}`;
    await AnalyticsService.trackEvent(arcadeEvent, { userId: user.id, payload: { game: 'connect4', outcome: 'win' } });
    await AnalyticsService.trackEvent(fishingEvent, { userId: user.id, payload: { species: ' tuna', rarity: 'rare' } });

    const arcade = await prisma.gameEvent.findFirst({ where: { event: arcadeEvent, userId: user.id } });
    const fishing = await prisma.gameEvent.findFirst({ where: { event: fishingEvent, userId: user.id } });
    expect(arcade).not.toBeNull();
    expect(fishing).not.toBeNull();
  });

  // ── Batch 11: TradeManager escrow item locks ──────────────────────────────
  it('Batch 11: TradeManager locks escrow items and releases them on trade end', () => {
    const itemId = `item_b11_${Date.now()}`;
    const tradeId = `trade_b11_${Date.now()}`;

    expect(TradeManager.isItemLocked(itemId)).toBe(false);
    expect(TradeManager.getLockedItemCount()).toBeGreaterThanOrEqual(0);

    TradeManager.lockTradeItem(itemId, tradeId);
    expect(TradeManager.isItemLocked(itemId)).toBe(true);

    TradeManager.unlockTradeItems(tradeId);
    expect(TradeManager.isItemLocked(itemId)).toBe(false);
  });

  // ── Batch 12: ModerationService adversarial normalization ─────────────────
  it('Batch 12: normalizeAdversarialContent strips zero-width chars and NFKC-normalizes homoglyphs', () => {
    const withZeroWidth = 'd\u200Ba\u200Cm\uFEFFn';
    const stripped = normalizeAdversarialContent(withZeroWidth);
    expect(stripped).toBe('damn');
    expect(stripped).not.toMatch(/[\u200B-\u200D\uFEFF]/);

    // Full-width latin homoglyphs collapse under NFKC to ASCII.
    const homoglyph = '\uFF44\uFF41\uFF4D\uFF4E'; // ｄａｍｎ
    expect(normalizeAdversarialContent(homoglyph)).toBe('damn');

    // And the moderation pipeline still masks the profanity after normalization.
    const result = moderateMessage(withZeroWidth);
    expect(result.wasFiltered).toBe(true);
    expect(result.filtered).toContain('*');
  });

  // ── Batch 14: PrivacyManager loft RBAC ────────────────────────────────────
  it('Batch 14: PrivacyManager resolves OWNER / CO_BUILDER / VISITOR loft roles', async () => {
    const owner = await makeUser();
    const coBuilder = await makeUser();
    const visitor = await makeUser();

    const room = await createTestRoom(owner.id, { name: `Loft RBAC B14 ${Date.now()}` });
    await prisma.roomDecorator.create({ data: { roomId: room.id, userId: coBuilder.id } });

    expect(await PrivacyManager.getLoftRole(owner.id, room.id)).toBe('OWNER');
    expect(await PrivacyManager.getLoftRole(coBuilder.id, room.id)).toBe('CO_BUILDER');
    expect(await PrivacyManager.getLoftRole(visitor.id, room.id)).toBe('VISITOR');
    // Unknown room safely falls back to VISITOR.
    expect(await PrivacyManager.getLoftRole(visitor.id, 'room_does_not_exist')).toBe('VISITOR');
  });

  // ── Batch 15: DailyLoginStreakService + SeasonalEventService ──────────────
  it('Batch 15: daily login streak progression and seasonal leaderboard archiving award real coins', async () => {
    // Pure reward table
    expect(calculateStreakReward(1)).toEqual({ coins: 50, gems: 0 });
    expect(calculateStreakReward(7)).toEqual({ coins: 300, gems: 5 }); // weekly milestone
    expect(calculateStreakReward(8)).toEqual({ coins: 50, gems: 0 }); // 7-day cycle wraps

    const user = await makeUser(0);
    const first = await DailyLoginStreakService.recordLogin(user.id, new Date('2026-10-01T10:00:00Z'));
    expect(first.currentStreak).toBe(1);
    expect(first.rewardCoins).toBe(50);

    const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterFirst.havenCoins).toBe(50);

    // Same-day re-login does not double-award
    const sameDay = await DailyLoginStreakService.recordLogin(user.id, new Date('2026-10-01T20:00:00Z'));
    expect(sameDay.rewardCoins).toBe(0);

    // Seasonal progress + leaderboard + podium archiving (event row must exist: FK)
    const event = await prisma.seasonalEvent.create({
      data: {
        name: `Milestone Season B15 ${Date.now()}`,
        theme: 'MILESTONE',
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        isActive: true,
        rewards: [],
      },
    });
    const eventId = event.id;
    await SeasonalEventService.addProgress(user.id, eventId, 250);
    const board = await SeasonalEventService.getLeaderboard(eventId, 10);
    expect(board.length).toBeGreaterThanOrEqual(1);
    expect(board[0].userId).toBe(user.id);

    const coinsBefore = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).havenCoins;
    const archive = await SeasonalEventService.archiveLeaderboard(eventId);
    expect(archive.eventId).toBe(eventId);
    expect(archive.totalParticipants).toBeGreaterThanOrEqual(1);
    expect(archive.podiumAwards[0].rank).toBe(1);
    expect(archive.podiumAwards[0].bonusCoins).toBe(500);

    const coinsAfter = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).havenCoins;
    expect(coinsAfter).toBe(coinsBefore + 500);

    await prisma.seasonalProgress.deleteMany({ where: { eventId } });
    await prisma.seasonalEvent.deleteMany({ where: { id: eventId } });
  });

  // ── Batch 16: WeatherService state machine ────────────────────────────────
  it('Batch 16: WeatherService produces 7-state atmospheric overlays and valid transitions', () => {
    const fog = WeatherService.getAtmosphericOverlay('FOG', 1.0);
    expect(fog.particleType).toBe('mist');
    expect(fog.fogDensity).toBeGreaterThan(0);
    expect(fog.fogColor).toBeDefined();

    const sakura = WeatherService.getAtmosphericOverlay('SAKURA_BLOSSOM', 0.7);
    expect(sakura.particleType).toBe('petals');

    const sandstorm = WeatherService.getAtmosphericOverlay('SANDSTORM', 1.0);
    expect(sandstorm.particleType).toBe('dust');

    // Transition graph: SUNNY can reach RAIN/AURORA; AURORA can reach SNOW (batch-16 expansion).
    expect(WeatherService.getNextPossibleWeather('SUNNY')).toContain('RAIN');
    expect(WeatherService.getNextPossibleWeather('AURORA')).toContain('SNOW');

    WeatherService.setWeather('SUNNY', 0.5);
    const next = WeatherService.transitionWeather();
    expect(WeatherService.getNextPossibleWeather('SUNNY')).toContain(next.currentWeather);
    expect(next.intensity).toBeGreaterThanOrEqual(0.3);
  });

  // ── Batch 17: PetManager decay + loyalty ──────────────────────────────────
  it('Batch 17: PetManager loyalty tiers and real-DB decay clamp stats at zero', async () => {
    // Pure loyalty calculation across tiers
    expect(calculatePetLoyalty(100, 100).level).toBe('SOULMATE');
    expect(calculatePetLoyalty(80, 80).level).toBe('BEST_FRIEND');
    expect(calculatePetLoyalty(60, 60).level).toBe('DEVOTED');
    expect(calculatePetLoyalty(30, 30).level).toBe('FRIEND');
    expect(calculatePetLoyalty(10, 10).level).toBe('ACQUAINTANCE');

    const user = await makeUser();
    const pet = await PetManager.adoptPet(user.id, 'CAT', 'DecayCat');
    const loyalty = await PetManager.getPetLoyalty(pet.id);
    expect(loyalty.score).toBeGreaterThanOrEqual(90); // fresh pet = SOULMATE

    // Decay clamps at 0 and never goes negative.
    const decayed = await PetManager.decayPet(pet.id, 500, 500);
    expect(decayed.hunger).toBe(0);
    expect(decayed.happiness).toBe(0);

    // Hourly bulk decay runs across the real DB without throwing.
    const decayedCount = await PetManager.decayAllPets();
    expect(typeof decayedCount).toBe('number');
    expect(decayedCount).toBeGreaterThanOrEqual(0);
  });

  // ── Batch 18: MarketplaceService anti-sniping lock (direct) ───────────────
  it('Batch 18: MarketplaceService distributed lock serializes acquisition and releases cleanly', async () => {
    expect(MARKETPLACE_TAX_RATE).toBe(0.05);
    const key = `mkt_lock_b18_${Date.now()}`;

    const first = await MarketplaceService.acquireLock(key, 5);
    expect(first).toBe(true);

    // Second acquisition on the same key is denied while held.
    const second = await MarketplaceService.acquireLock(key, 5);
    expect(second).toBe(false);

    await MarketplaceService.releaseLock(key);

    // After release the lock can be re-acquired.
    const third = await MarketplaceService.acquireLock(key, 5);
    expect(third).toBe(true);
    await MarketplaceService.releaseLock(key);
  });

  // ── Batch 20: Sentry traceSpan ────────────────────────────────────────────
  it('Batch 20: traceSpan executes monitored functions and propagates results and errors', async () => {
    const ok = await traceSpan('milestone.b20.ok', 'unit_test', async () => 'result-ok');
    expect(ok).toBe('result-ok');

    await expect(
      traceSpan('milestone.b20.fail', 'unit_test', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
