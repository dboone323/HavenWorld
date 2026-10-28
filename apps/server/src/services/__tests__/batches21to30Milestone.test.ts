import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { SecretRoomService } from '../SecretRoomService';
import { FishingService } from '../FishingService';
import { PizzaService } from '../PizzaService';
import { CraftingService } from '../CraftingService';
import { JukeboxService } from '../JukeboxService';
import { ArcadeService } from '../ArcadeService';
import { TransitService } from '../TransitService';
import { ScavengerHuntService } from '../ScavengerHuntService';
import { DatabaseHealthTelemetryService } from '../DatabaseHealthTelemetryService';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('Batches 21–30 Milestone End-to-End Suite (Real Database Validation)', () => {
  const createdUserIds: string[] = [];

  async function makeUser(havenCoins = 100) {
    const user = await createTestUser({ havenCoins });
    createdUserIds.push(user.id);
    return user;
  }

  afterEach(async () => {
    TransitService.resetForTesting();
    ScavengerHuntService.resetForTesting();
    JukeboxService.resetThrottle();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.fishCatch.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.craftingQueue.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.materialInventory.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.minigameSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.weeklyEarningsCap.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.arcadeSettlementOutbox.deleteMany({
        where: { OR: [{ player1Id: { in: createdUserIds } }, { player2Id: { in: createdUserIds } }] },
      });
      await prisma.achievement.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.gameEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.transactionLog.deleteMany({
        where: { OR: [{ senderId: { in: createdUserIds } }, { receiverId: { in: createdUserIds } }] },
      });
      await prisma.room.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it('Batch 21: SecretRoomService discovers secret chambers and awards first-time bounty', async () => {
    const user = await makeUser(50);
    const result = await SecretRoomService.checkSecretTrigger(user.id, 'room_lobby', 'abracadabra');

    expect(result.triggered).toBe(true);
    expect(result.secretRoomId).toBe('room_secret_observatory');
    expect(result.isFirstDiscovery).toBe(true);
    expect(result.bountyCoins).toBe(100);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.havenCoins).toBe(150);
  });

  it('Batch 22: FishingService calculates weather bonus and flags trophy catches', () => {
    const auroraBonus = FishingService.calculateWeatherBonus('AURORA');
    expect(auroraBonus.rarityBonus).toBe(15);
    expect(auroraBonus.weightMultiplier).toBe(1.25);

    const fish = FishingService.pickRandomFish('AURORA');
    expect(fish).toBeDefined();

    const weightRes = FishingService.calculateFishWeight(fish, auroraBonus.weightMultiplier);
    expect(weightRes.weightLbs).toBeGreaterThan(0);
  });

  it('Batch 23: PizzaService computes time-decayed score and streak combo multiplier', async () => {
    const user = await makeUser(50);
    PizzaService.resetStreak(user.id);

    const order = await PizzaService.submitChefOrder(user.id, {
      recipe: 'margherita',
      ingredients: ['dough', 'sauce', 'mozzarella'],
      durationMs: 3000,
    });

    expect(order.tier).toBe('PERFECT');
    expect(order.streak).toBe(1);
    expect(order.coinsEarned).toBeGreaterThan(0);
  });

  it('Batch 24: CraftingService enforces recipe unlocks and queue slot capacity', async () => {
    const user = await makeUser(100);
    CraftingService.resetRecipeUnlocks(user.id);
    CraftingService.resetQueueSlots(user.id);

    const maxSlots = await CraftingService.getUserMaxQueueSlots(user.id);
    expect(maxSlots).toBe(2);

    const unlocked = await CraftingService.unlockRecipe(user.id, 'recipe_steampunk_sofa');
    expect(unlocked.success).toBe(true);
    expect(await CraftingService.isRecipeUnlocked(user.id, 'recipe_steampunk_sofa')).toBe(true);
  });

  it('Batch 25: JukeboxService sets custom playlist and applies skip throttle', () => {
    const pl = JukeboxService.setRoomPlaylist('room-milestone', ['haven_nostalgia', 'cozy_fireplace']);
    expect(pl.playlist).toHaveLength(2);

    const skip1 = JukeboxService.skipTrack('room-milestone', 'user-dj');
    expect(skip1.track.id).toBe('cozy_fireplace');

    // Throttled within 5 seconds
    expect(() => JukeboxService.skipTrack('room-milestone', 'user-dj')).toThrow(/throttled/i);
  });

  it('Batch 26: ArcadeService resolves forfeits and conducts rematch handshake', async () => {
    const p1 = await makeUser(100);
    const p2 = await makeUser(100);

    const match = ArcadeService.startMatch(p1.id, p2.id, 'cab-milestone');
    const forfeited = ArcadeService.forfeitMatch(match.id, p1.id);

    expect(forfeited.status).toBe('FINISHED');
    expect(forfeited.winnerId).toBe(p2.id);

    // Rematch handshake
    const req1 = ArcadeService.requestRematch(match.id, p1.id);
    expect(req1.status).toBe('PENDING');

    const req2 = ArcadeService.requestRematch(match.id, p2.id);
    expect(req2.status).toBe('ACCEPTED');
    expect(req2.newMatch?.status).toBe('IN_PROGRESS');
  });

  it('Batch 27: TransitService advances circular station schedule and sells tickets', async () => {
    const rider = await makeUser(50);
    const ticket = await TransitService.purchaseTicket(rider.id);
    expect(ticket.cost).toBe(TransitService.TICKET_PRICE);

    const schedule = TransitService.getStationSchedule();
    expect(schedule.length).toBe(4);

    const board = TransitService.boardTram(rider.id, schedule[0].station, { requireTicket: true });
    expect(board.success).toBe(true);
  });

  it('Batch 28: ScavengerHuntService validates cryptographic solution and disburses rewards', async () => {
    const hunter = await makeUser(100);

    const solve1 = await ScavengerHuntService.solveClue(
      hunter.id,
      1,
      'room-park',
      'mossy_stone_alpha'
    );
    expect(solve1.nextClueIndex).toBe(2);

    const solve2 = await ScavengerHuntService.solveClue(
      hunter.id,
      2,
      'room-town-square',
      'brass_cog_beta'
    );
    expect(solve2.nextClueIndex).toBe(3);

    const solve3 = await ScavengerHuntService.solveClue(
      hunter.id,
      3,
      'room-wharf',
      'pier_chest_omega'
    );
    expect(solve3.isCompleted).toBe(true);
    expect(solve3.reward?.coinsAwarded).toBeGreaterThanOrEqual(250);
  });

  it('Batch 29: Client offline shell and fallback assets match service worker specification', () => {
    const clientPublic = path.resolve(__dirname, '../../../../client/public');
    const swFile = path.join(clientPublic, 'sw.js');
    const offlineFile = path.join(clientPublic, 'offline.html');

    expect(existsSync(swFile)).toBe(true);
    expect(existsSync(offlineFile)).toBe(true);

    const sw = readFileSync(swFile, 'utf8');
    expect(sw).toContain('offline.html');
    expect(sw).toContain('CLEAR_OUTDATED_CACHES');
  });

  it('Batch 30: DatabaseHealthTelemetryService reports real PostgreSQL health and latencies', async () => {
    const report = await DatabaseHealthTelemetryService.getTelemetryReport();

    expect(['HEALTHY', 'DEGRADED']).toContain(report.status);
    expect(report.pingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.storageMetrics.isWriteCapable).toBe(true);
    expect(report.tableCounts.users).toBeGreaterThan(0);
    expect(report.benchmark.readLatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.benchmark.writeLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
