export type SeasonName = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';

export interface SeasonalOverlayConfig {
  season: SeasonName;
  outdoorTilesetKey: string;
  particleType: 'blossoms' | 'sunbeams' | 'falling_leaves' | 'snowflakes';
  ambientTint: string;
  festivalName: string;
}

export class SeasonalThemeService {
  /**
   * Resolves season dynamically from UTC month
   */
  static getSeasonForDate(date: Date = new Date()): SeasonName {
    const month = date.getUTCMonth(); // 0 = Jan, 11 = Dec
    if (month >= 2 && month <= 4) return 'SPRING'; // Mar, Apr, May
    if (month >= 5 && month <= 7) return 'SUMMER'; // Jun, Jul, Aug
    if (month >= 8 && month <= 10) return 'AUTUMN'; // Sep, Oct, Nov
    return 'WINTER'; // Dec, Jan, Feb
  }

  /**
   * Returns overlay configuration for the current season without rebuilding room data
   */
  static getSeasonalConfig(date: Date = new Date()): SeasonalOverlayConfig {
    const season = this.getSeasonForDate(date);

    switch (season) {
      case 'SPRING':
        return {
          season,
          outdoorTilesetKey: 'outdoor-spring',
          particleType: 'blossoms',
          ambientTint: 'rgba(255, 230, 240, 0.08)',
          festivalName: 'Bloom Blossom Carnival',
        };
      case 'SUMMER':
        return {
          season,
          outdoorTilesetKey: 'outdoor-summer',
          particleType: 'sunbeams',
          ambientTint: 'rgba(255, 250, 200, 0.05)',
          festivalName: 'Sunken Cove Summer Splash',
        };
      case 'AUTUMN':
        return {
          season,
          outdoorTilesetKey: 'outdoor-autumn',
          particleType: 'falling_leaves',
          ambientTint: 'rgba(255, 180, 100, 0.10)',
          festivalName: 'Harvest Lantern Festival',
        };
      case 'WINTER':
        return {
          season,
          outdoorTilesetKey: 'outdoor-winter',
          particleType: 'snowflakes',
          ambientTint: 'rgba(200, 230, 255, 0.12)',
          festivalName: 'Winter Frost Gala',
        };
    }
  }
}
