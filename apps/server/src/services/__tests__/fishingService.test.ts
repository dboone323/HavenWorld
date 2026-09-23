import { FishingService } from '../FishingService';

jest.mock('../../prisma', () => ({
  prisma: {
    fishCatch: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}) },
    fishingLeaderboard: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

jest.mock('../../sockets', () => ({
  getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

jest.mock('../AnalyticsService', () => ({
  AnalyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../QuestService', () => ({
  QuestService: { incrementProgress: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../AchievementService', () => ({
  AchievementService: { checkAndAward: jest.fn().mockResolvedValue(undefined) },
}));

import { prisma } from '../../prisma';

type TestSession = {
  userId: string;
  roomId: string;
  currentTension: number;
  sweetSpotCenter: number;
  sweetSpotWidth: number;
  playerReelPos: number;
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

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('FishingService', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const userId of Array.from(sessions.keys())) {
      FishingService.cancelSession(userId);
    }
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('startSession seeds a session; restarting replaces the previous one', () => {
    FishingService.startSession('u1', 'room-park');
    let session = stabilize('u1');
    expect(session).toBeDefined();
    expect(session?.roomId).toBe('room-park');
    expect(session?.intervalTimer).toBeNull();

    FishingService.startSession('u1', 'room-lobby');
    session = stabilize('u1');
    expect(sessions.size).toBe(1);
    expect(session?.roomId).toBe('room-lobby');

    FishingService.cancelSession('u1');
    expect(sessions.has('u1')).toBe(false);
  });

  it('updateReelPosition clamps to [0,1] and ignores unknown users', () => {
    FishingService.startSession('u1', 'room-park');
    stabilize('u1');

    FishingService.updateReelPosition('u1', 5);
    expect(sessions.get('u1')?.playerReelPos).toBe(1);
    FishingService.updateReelPosition('u1', -3);
    expect(sessions.get('u1')?.playerReelPos).toBe(0);
    expect(() => FishingService.updateReelPosition('ghost', 0.5)).not.toThrow();
  });

  it('tick: staying in the sweet spot wins the catch and records rewards', async () => {
    FishingService.startSession('u1', 'room-park');
    const session = stabilize('u1')!;
    session.sweetSpotWidth = 1; // whole range is sweet spot → guaranteed tension gain
    session.playerReelPos = 0.5;

    for (let i = 0; i < 500 && sessions.has('u1'); i++) {
      await tick('u1');
    }
    await flush();

    expect(sessions.has('u1')).toBe(false);
    expect(prisma.fishCatch.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.fishingLeaderboard.upsert).toHaveBeenCalledTimes(1);
  });

  it('tick: losing all tension ends the session as a loss', async () => {
    FishingService.startSession('u1', 'room-park');
    const session = stabilize('u1')!;
    session.sweetSpotWidth = 0.02;
    session.sweetSpotCenter = 0.5;
    session.playerReelPos = 0; // outside [0.49, 0.51] → tension drains
    session.currentTension = 1e-9;

    await tick('u1');
    await flush();

    expect(sessions.has('u1')).toBe(false);
    expect(prisma.fishCatch.create).not.toHaveBeenCalled();
  });

  it('endSessionSuccess logs and swallows persistence errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (prisma.fishCatch.create as unknown as jest.Mock).mockRejectedValueOnce(new Error('db down'));

    FishingService.startSession('u1', 'room-park');
    const session = stabilize('u1')!;
    session.sweetSpotWidth = 1;
    session.playerReelPos = 0.5;

    for (let i = 0; i < 500 && sessions.has('u1'); i++) {
      await tick('u1');
    }
    await flush();

    expect(sessions.has('u1')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      '[FishingService] Error recording catch:',
      expect.any(Error)
    );
  });

  it('getWeeklyLeaderboard returns the top 10 weighted catches', async () => {
    const rows = [{ userId: 'a', weightLbs: 12 }];
    (prisma.fishingLeaderboard.findMany as unknown as jest.Mock).mockResolvedValueOnce(rows);

    const result = await FishingService.getWeeklyLeaderboard();

    expect(result).toBe(rows);
    expect(prisma.fishingLeaderboard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  it('resetWeeklyLeaderboard awards top-3 prizes and clears archived rows', async () => {
    (prisma.fishingLeaderboard.findMany as unknown as jest.Mock).mockResolvedValueOnce([
      { userId: 'a', weightLbs: 12 },
      { userId: 'b', weightLbs: 11 },
      { userId: 'c', weightLbs: 10 },
      { userId: 'd', weightLbs: 9 },
    ]);

    await FishingService.resetWeeklyLeaderboard();

    expect(prisma.user.update).toHaveBeenCalledTimes(3);
    expect(prisma.user.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { havenCoins: { increment: 500 } } })
    );
    expect(prisma.fishingLeaderboard.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('resetWeeklyLeaderboard with no catches still clears old rows', async () => {
    (prisma.fishingLeaderboard.findMany as unknown as jest.Mock).mockResolvedValueOnce([]);

    await FishingService.resetWeeklyLeaderboard();

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.fishingLeaderboard.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('cancelSession and tick tolerate unknown users', async () => {
    expect(() => FishingService.cancelSession('ghost')).not.toThrow();
    await expect(tick('ghost')).resolves.toBeUndefined();
  });
});