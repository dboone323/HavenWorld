import { GlobalEventService } from '../GlobalEventService';
import { redisClient, connectRedis } from '../../redis';

describe('Batch 36: Live Event Broadcast Countdown Timer & Synchronized Triggers', () => {
  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterEach(async () => {
    await GlobalEventService.terminateActiveEvent();
  });

  it('schedules an upcoming live event with countdown timer and banner broadcast', async () => {
    const scheduled = await GlobalEventService.scheduleGlobalEvent({
      type: 'AURORA_BOREALIS',
      title: 'Aurora Borealis Night Sky',
      description: 'Luminous skies over HavenWorld! Enhanced rare fish appearance.',
      startsInSeconds: 300,
      durationMinutes: 45,
      multiplier: 2.0,
    });

    expect(scheduled.id).toBeDefined();
    expect(scheduled.status).toBe('SCHEDULED');
    expect(scheduled.countdownSeconds).toBe(300);

    // Calculate countdown remaining
    const remaining = GlobalEventService.calculateCountdownRemaining(scheduled);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(300);

    // Query upcoming events
    const upcoming = GlobalEventService.getUpcomingEvents();
    expect(upcoming.some((e) => e.id === scheduled.id)).toBe(true);

    // Cancel event
    const cancelled = await GlobalEventService.cancelScheduledEvent(scheduled.id);
    expect(cancelled).toBe(true);
    expect(GlobalEventService.getUpcomingEvents().some((e) => e.id === scheduled.id)).toBe(false);
  });

  it('triggers immediate global live event, updates coin multiplier, and terminates on completion', async () => {
    expect(GlobalEventService.getCurrentCoinMultiplier()).toBe(1.0);

    const event = await GlobalEventService.triggerGlobalEvent(
      'DOUBLE_COINS',
      'HavenWorld Golden Hour',
      'Double HavenCoins awarded on all activities!',
      30,
      2.0
    );

    expect(event.isActive).toBe(true);
    expect(event.multiplier).toBe(2.0);

    // Multiplier reflects active event
    expect(GlobalEventService.getCurrentCoinMultiplier()).toBe(2.0);

    // Active event query
    const active = GlobalEventService.getActiveEvent();
    expect(active?.id).toBe(event.id);
    expect(active?.type).toBe('DOUBLE_COINS');

    // Terminate
    await GlobalEventService.terminateActiveEvent();
    expect(GlobalEventService.getActiveEvent()).toBeNull();
    expect(GlobalEventService.getCurrentCoinMultiplier()).toBe(1.0);
  });
});
