import { WeatherService, WorldWeather } from '../WeatherService';

describe('Batch 41: Dynamic Weather Visual Particles & Atmospheric Profiles', () => {
  it('correctly returns overlays for all weather conditions including SAKURA_BLOSSOM, SANDSTORM, and FOG', () => {
    const weathers: WorldWeather[] = [
      'SUNNY',
      'RAIN',
      'AURORA',
      'SNOW',
      'SAKURA_BLOSSOM',
      'SANDSTORM',
      'FOG',
    ];

    for (const w of weathers) {
      const overlay = WeatherService.getAtmosphericOverlay(w, 0.7);
      expect(overlay).toBeDefined();
      expect(overlay.ambientColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(overlay.fogDensity).toBeGreaterThan(0);
      expect(overlay.windSpeed).toBeGreaterThan(0);
      expect(typeof overlay.particleCount).toBe('number');
      expect(overlay.sunIntensity).toBeDefined();
      expect(overlay.particleType).toBeDefined();
    }
  });

  it('validates state machine transitions for all weather types', () => {
    const transitions = WeatherService.getNextPossibleWeather('SAKURA_BLOSSOM');
    expect(transitions).toContain('SAKURA_BLOSSOM');
    expect(transitions).toContain('SUNNY');

    const fogTransitions = WeatherService.getNextPossibleWeather('FOG');
    expect(fogTransitions).toContain('SUNNY');
    expect(fogTransitions).toContain('RAIN');
  });

  it('interpolates atmospheric overlays between two weather conditions smoothly', () => {
    const sunny = WeatherService.getAtmosphericOverlay('SUNNY', 0.5);
    const sandstorm = WeatherService.getAtmosphericOverlay('SANDSTORM', 1.0);

    const mid = WeatherService.interpolateOverlay(sunny, sandstorm, 0.5);
    expect(mid.fogDensity).toBeGreaterThan(sunny.fogDensity);
    expect(mid.fogDensity).toBeLessThan(sandstorm.fogDensity);
    expect(mid.particleCount).toBeGreaterThan(sunny.particleCount);
    expect(mid.particleCount).toBeLessThan(sandstorm.particleCount);
    expect(mid.windSpeed).toBeGreaterThan(sunny.windSpeed);
  });
});
