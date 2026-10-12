import { AnalyticsService } from '../AnalyticsService';
import { prisma } from '../../prisma';

describe('Batch 5: AnalyticsService & Telemetry Aggregations', () => {
  it('tracks game events and safely aggregates minigame statistics', async () => {
    await AnalyticsService.trackEvent('FISH_CAUGHT', {
      payload: { fish: 'Salmon', weight: 4.2 },
    });
    await AnalyticsService.trackEvent('CRAFT_ITEM', {
      payload: { recipe: 'wood_chair' },
    });

    const stats = await AnalyticsService.minigameStats(7);
    expect(Array.isArray(stats)).toBe(true);

    const fishCaught = stats.find((s) => s.event === 'FISH_CAUGHT');
    expect(fishCaught).toBeDefined();
    expect(fishCaught!.plays).toBeGreaterThanOrEqual(1);
  });

  it('computes daily active users array for requested window', async () => {
    const user = await prisma.user.findFirst();
    if (user) {
      await AnalyticsService.trackEvent('LOGIN', { userId: user.id });
    }
    const dau = await AnalyticsService.dau(7);
    expect(Array.isArray(dau)).toBe(true);
    if (user) {
      expect(dau.length).toBeGreaterThanOrEqual(1);
      expect(typeof dau[0].day).toBe('string');
      expect(typeof dau[0].users).toBe('number');
    }
  });

  it('computes economy health metrics', async () => {
    const health = await AnalyticsService.economyHealth(7);
    expect(health).toHaveProperty('coinSupply');
    expect(typeof health.coinSupply).toBe('number');
    expect(Array.isArray(health.faucets)).toBe(true);
    expect(Array.isArray(health.sinks)).toBe(true);
  });
});
