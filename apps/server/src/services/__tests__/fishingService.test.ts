import { FishingService } from '../FishingService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';

type TestSession = {
  userId: string;
  roomId: string;
  currentTension: number;
  sweetSpotCenter: number;
  sweetSpotWidth: number;
  playerReelPos: number;
  weightLbs: number;
  intervalTimer: NodeJS.Timeout | null;
};

const sessions = (FishingService as unknown as { activeSessions: Map<string, TestSession> })
  .activeSessions;

const tick = (userId: string) =>
  (FishingService as unknown as { tickSession(id: string): Promise<void> }).tickSession(userId);

/** Clears the live 10Hz interval so tests drive ticks deterministically. */
function stabilize(userId: string): TestSession | undefined {
  const session = sessions.get(userId);
  if (session?.intervalTimer) {
    clearInterval(session.intervalTimer);
    session.intervalTimer = null;
  }
  return session;
}

function currentWeekStart(): Date {
  const startOfWeek = new Date();
  startOfWeek.setUTCHours(0, 0, 0, 0);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
  return startOfWeek;
}

describe('FishingService (Real Database Validation)', () => {
  const createdUserIds: string[] = [];

  async function makeUser(havenCoins = 100) {
    const user = await createTestUser({ havenCoins });
    createdUserIds.push(user.id);
    return user;
  }

  afterEach(async () => {
    for (const userId of Array.from(sessions.keys())) {
      FishingService.cancelSession(userId);
    }
    await prisma.fishingLeaderboard.deleteMany({});
    if (createdUserIds.length > 0) {
      await prisma.fishCatch.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
  });

  afterAll(async () => {
    await prisma.fishingLeaderboard.deleteMany({});
    if (createdUserIds.length > 0) {
      await prisma.fishCatch.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.room.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  it('startSession seeds a session; restarting replaces the previous one', async () => {
    const user = await makeUser();
    FishingService.startSession(user.id, 'room-park');
    let session = stabilize(user.id);
    expect(session).toBeDefined();
    expect(session?.roomId).toBe('room-park');
    expect(session?.intervalTimer).toBeNull();

    FishingService.startSession(user.id, 'room-lobby');
    session = stabilize(user.id);
    expect(sessions.size).toBe(1);
    expect(session?.roomId).toBe('room-lobby');

    FishingService.cancelSession(user.id);
    expect(sessions.has(user.id)).toBe(false);
  });

  it('updateReelPosition clamps to [0,1] and ignores unknown users', async () => {
    const user = await makeUser();
    FishingService.startSession(user.id, 'room-park');
    stabilize(user.id);

    FishingService.updateReelPosition(user.id, 5);
    expect(sessions.get(user.id)?.playerReelPos).toBe(1);
    FishingService.updateReelPosition(user.id, -3);
    expect(sessions.get(user.id)?.playerReelPos).toBe(0);
    expect(() => FishingService.updateReelPosition('ghost', 0.5)).not.toThrow();
  });

  it('tick: staying in the sweet spot wins the catch and persists rewards in the database', async () => {
    const user = await makeUser(100);
    FishingService.startSession(user.id, 'room-park');
    const session = stabilize(user.id)!;
    session.sweetSpotWidth = 1; // whole range is sweet spot -> guaranteed tension gain
    session.playerReelPos = 0.5;
    session.currentTension = 0.99;

    await tick(user.id);
    // Allow async endSessionSuccess DB writes to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(sessions.has(user.id)).toBe(false);

    const catches = await prisma.fishCatch.findMany({ where: { userId: user.id } });
    expect(catches).toHaveLength(1);
    expect(catches[0].coinsEarned).toBeGreaterThan(0);

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updatedUser.havenCoins).toBe(100 + catches[0].coinsEarned);

    const lb = await prisma.fishingLeaderboard.findMany({ where: { userId: user.id } });
    expect(lb).toHaveLength(1);
    expect(lb[0].weightLbs).toBeCloseTo(session.weightLbs, 2);

    // Second catch with a smaller weight does not overwrite personal best on leaderboard
    FishingService.startSession(user.id, 'room-park');
    const session2 = stabilize(user.id)!;
    session2.sweetSpotWidth = 1;
    session2.playerReelPos = 0.5;
    session2.weightLbs = Math.max(0.01, session.weightLbs - 0.5);
    session2.currentTension = 0.99;
    await tick(user.id);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const lbAfter = await prisma.fishingLeaderboard.findFirstOrThrow({ where: { userId: user.id } });
    expect(lbAfter.weightLbs).toBeCloseTo(session.weightLbs, 2);
  });

  it('tick: losing all tension ends the session as a loss without recording a catch', async () => {
    const user = await makeUser(100);
    FishingService.startSession(user.id, 'room-park');
    const session = stabilize(user.id)!;
    session.sweetSpotWidth = 0.02;
    session.sweetSpotCenter = 0.5;
    session.playerReelPos = 0; // outside [0.49, 0.51] -> tension drains
    session.currentTension = 1e-9;

    await tick(user.id);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sessions.has(user.id)).toBe(false);
    const catches = await prisma.fishCatch.count({ where: { userId: user.id } });
    expect(catches).toBe(0);
  });

  it('endSessionSuccess handles database foreign-key errors gracefully without crashing', async () => {
    const nonExistentUserId = 'missing-fishing-user-id';
    FishingService.startSession(nonExistentUserId, 'room-park');
    const session = stabilize(nonExistentUserId)!;
    session.sweetSpotWidth = 1;
    session.playerReelPos = 0.5;
    session.currentTension = 0.99;

    await expect(tick(nonExistentUserId)).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessions.has(nonExistentUserId)).toBe(false);
  });

  it('getWeeklyLeaderboard returns the top weighted catches in descending order', async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const weekOf = currentWeekStart();

    await prisma.fishingLeaderboard.createMany({
      data: [
        { userId: u1.id, species: 'Bass', weightLbs: 8.5, weekOf },
        { userId: u2.id, species: 'Carp', weightLbs: 14.2, weekOf },
      ],
    });

    const result = await FishingService.getWeeklyLeaderboard();
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].userId).toBe(u2.id);
    expect(result[0].weightLbs).toBe(14.2);
    expect(result[1].userId).toBe(u1.id);
  });

  it('resetWeeklyLeaderboard awards top-3 prizes (500, 250, 100) and clears archived rows', async () => {
    const u1 = await makeUser(0);
    const u2 = await makeUser(0);
    const u3 = await makeUser(0);
    const u4 = await makeUser(0);
    const weekOf = currentWeekStart();
    const lastWeek = new Date(weekOf.getTime() - 7 * 86400_000);

    await prisma.fishingLeaderboard.createMany({
      data: [
        { userId: u1.id, species: 'Marlin', weightLbs: 20, weekOf },
        { userId: u2.id, species: 'Salmon', weightLbs: 15, weekOf },
        { userId: u3.id, species: 'Trout', weightLbs: 10, weekOf },
        { userId: u4.id, species: 'Perch', weightLbs: 5, weekOf },
        { userId: u4.id, species: 'OldPerch', weightLbs: 3, weekOf: lastWeek },
      ],
    });

    await FishingService.resetWeeklyLeaderboard();

    const [db1, db2, db3, db4, oldRows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: u1.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: u2.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: u3.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: u4.id } }),
      prisma.fishingLeaderboard.count({ where: { weekOf: { lt: weekOf } } }),
    ]);

    expect(db1.havenCoins).toBe(500);
    expect(db2.havenCoins).toBe(250);
    expect(db3.havenCoins).toBe(100);
    expect(db4.havenCoins).toBe(0);
    expect(oldRows).toBe(0);
  });

  it('resetWeeklyLeaderboard with no current catches still clears old rows', async () => {
    const u1 = await makeUser(50);
    const weekOf = currentWeekStart();
    const lastWeek = new Date(weekOf.getTime() - 7 * 86400_000);

    await prisma.fishingLeaderboard.create({
      data: { userId: u1.id, species: 'OldFish', weightLbs: 4, weekOf: lastWeek },
    });

    await FishingService.resetWeeklyLeaderboard();

    const db1 = await prisma.user.findUniqueOrThrow({ where: { id: u1.id } });
    expect(db1.havenCoins).toBe(50);
    const oldRows = await prisma.fishingLeaderboard.count({ where: { weekOf: { lt: weekOf } } });
    expect(oldRows).toBe(0);
  });

  it('cancelSession and tick tolerate unknown users', async () => {
    expect(() => FishingService.cancelSession('ghost')).not.toThrow();
    await expect(tick('ghost')).resolves.toBeUndefined();
  });
});