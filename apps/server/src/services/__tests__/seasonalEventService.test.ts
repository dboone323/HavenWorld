import { SeasonalEventService } from '../SeasonalEventService';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';

describe('SeasonalEventService', () => {
  beforeAll(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('Active event retrieval and end-date validation', () => {
    it('correctly retrieves the active event and ignores future, expired, or deactivated events', async () => {
      const now = new Date();

      // 1. Inactive event (matching date range but isActive: false)
      await prisma.seasonalEvent.create({
        data: {
          name: 'Draft Winter Gala',
          theme: 'WINTER',
          startsAt: new Date(now.getTime() - 86400_000),
          endsAt: new Date(now.getTime() + 86400_000),
          isActive: false,
          rewards: [],
        },
      });

      // 2. Future event (starts in 2 days)
      await prisma.seasonalEvent.create({
        data: {
          name: 'Future Spring Bloom',
          theme: 'SPRING',
          startsAt: new Date(now.getTime() + 172800_000),
          endsAt: new Date(now.getTime() + 345600_000),
          isActive: true,
          rewards: [],
        },
      });

      // 3. Past expired event (ended yesterday)
      await prisma.seasonalEvent.create({
        data: {
          name: 'Past Summer Carnival',
          theme: 'SUMMER',
          startsAt: new Date(now.getTime() - 172800_000),
          endsAt: new Date(now.getTime() - 86400_000),
          isActive: true,
          rewards: [],
        },
      });

      // At this point, getActiveEvent() must return null
      let active = await SeasonalEventService.getActiveEvent();
      expect(active).toBeNull();

      // 4. Create currently valid active event
      const currentEvent = await prisma.seasonalEvent.create({
        data: {
          name: 'Active Autumn Festival',
          theme: 'AUTUMN',
          startsAt: new Date(now.getTime() - 3600_000),
          endsAt: new Date(now.getTime() + 3600_000),
          isActive: true,
          rewards: [],
        },
      });

      active = await SeasonalEventService.getActiveEvent();
      expect(active).not.toBeNull();
      expect(active?.id).toBe(currentEvent.id);
      expect(active?.name).toBe('Active Autumn Festival');
    });
  });

  describe('convertExpiredEvents()', () => {
    it('closes expired events, archives leaderboards with podium awards, and converts tokens 1:1 to HavenCoins', async () => {
      const initialCoins = 100;
      const user1 = await createTestUser({ havenCoins: initialCoins });
      const user2 = await createTestUser({ havenCoins: initialCoins });
      const user3 = await createTestUser({ havenCoins: initialCoins });

      // Create an expired event
      const pastEvent = await prisma.seasonalEvent.create({
        data: {
          name: 'Expired Autumn Gala',
          theme: 'AUTUMN',
          startsAt: new Date(Date.now() - 7200_000),
          endsAt: new Date(Date.now() - 3600_000), // Ended 1 hour ago
          isActive: true,
          rewards: [],
        },
      });

      // Add seasonal currency for users
      await SeasonalEventService.addProgress(user1.id, pastEvent.id, 250); // Rank 1
      await SeasonalEventService.addProgress(user2.id, pastEvent.id, 120); // Rank 2
      await SeasonalEventService.addProgress(user3.id, pastEvent.id, 50);  // Rank 3

      // Execute cron conversion
      const result = await SeasonalEventService.convertExpiredEvents();

      expect(result.convertedEvents).toBeGreaterThanOrEqual(1);
      expect(result.coinsIssued).toBe(250 + 120 + 50); // 420 total converted tokens

      // 1. Verify Event is marked inactive in DB
      const updatedEvent = await prisma.seasonalEvent.findUnique({ where: { id: pastEvent.id } });
      expect(updatedEvent?.isActive).toBe(false);

      // 2. Verify seasonal currency is reset to 0 in progress records
      const progressEntries = await prisma.seasonalProgress.findMany({ where: { eventId: pastEvent.id } });
      expect(progressEntries.every((p) => p.currency === 0)).toBe(true);

      // 3. Verify user wallet balances:
      // User 1 (Rank 1): 100 initial + 500 podium + 250 converted = 850
      // User 2 (Rank 2): 100 initial + 300 podium + 120 converted = 520
      // User 3 (Rank 3): 100 initial + 150 podium + 50 converted = 300
      const dbUser1 = await prisma.user.findUnique({ where: { id: user1.id } });
      const dbUser2 = await prisma.user.findUnique({ where: { id: user2.id } });
      const dbUser3 = await prisma.user.findUnique({ where: { id: user3.id } });

      expect(dbUser1?.havenCoins).toBe(initialCoins + 500 + 250);
      expect(dbUser2?.havenCoins).toBe(initialCoins + 300 + 120);
      expect(dbUser3?.havenCoins).toBe(initialCoins + 150 + 50);

      // 4. Verify transaction audit logs exist
      const conversionLogs = await prisma.transactionLog.findMany({
        where: { type: 'SEASONAL_CONVERSION', source: pastEvent.id },
      });
      expect(conversionLogs).toHaveLength(3);

      const podiumLogs = await prisma.transactionLog.findMany({
        where: { type: 'SEASONAL_PODIUM_AWARD' },
      });
      expect(podiumLogs.length).toBeGreaterThanOrEqual(3);

      // 5. Idempotency test: calling convertExpiredEvents again should find 0 pending expired events
      const secondRun = await SeasonalEventService.convertExpiredEvents();
      expect(secondRun.convertedEvents).toBe(0);
      expect(secondRun.coinsIssued).toBe(0);
    });
  });
});
