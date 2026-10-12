import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export type WorldWeather = 'SUNNY' | 'RAIN' | 'AURORA' | 'SNOW' | 'SAKURA_BLOSSOM' | 'SANDSTORM' | 'FOG';

export interface AtmosphericOverlay {
  ambientColor: string;
  fogDensity: number;
  particleCount: number;
  windSpeed: number;
  tint: string;
  soundEffect: string | null;
  fogColor?: string;
  sunIntensity?: number;
  particleType?: 'rain' | 'snow' | 'petals' | 'dust' | 'mist' | 'stars' | 'none';
  particleSpeed?: number;
}

export interface WeatherState {
  currentWeather: WorldWeather;
  intensity: number; // 0.0 to 1.0
  changedAt: number;
  overlay?: AtmosphericOverlay;
}

export class WeatherService {
  private static currentWeather: WorldWeather = 'SUNNY';
  private static intensity: number = 0.5;
  private static changedAt: number = Date.now();

  /**
   * Computes atmospheric visual and audio overlay parameters for a weather state
   */
  static getAtmosphericOverlay(weather: WorldWeather, intensity: number = 0.5): AtmosphericOverlay {
    const clamped = Math.max(0, Math.min(1, intensity));
    switch (weather) {
      case 'RAIN':
        return {
          ambientColor: '#4a5568',
          fogColor: '#424d5d',
          fogDensity: 0.01 + 0.03 * clamped,
          particleCount: Math.round(500 * clamped),
          windSpeed: 0.3 + 0.5 * clamped,
          tint: '#334155',
          soundEffect: 'ambient_rain',
          sunIntensity: 0.35 * (1 - clamped * 0.5),
          particleType: 'rain',
          particleSpeed: 10 + 5 * clamped,
        };
      case 'SNOW':
        return {
          ambientColor: '#cbd5e1',
          fogColor: '#e0e7ff',
          fogDensity: 0.02 + 0.04 * clamped,
          particleCount: Math.round(300 * clamped),
          windSpeed: 0.1 + 0.4 * clamped,
          tint: '#e2e8f0',
          soundEffect: 'ambient_wind',
          sunIntensity: 0.65,
          particleType: 'snow',
          particleSpeed: 2.5 + 2 * clamped,
        };
      case 'AURORA':
        return {
          ambientColor: '#1e1b4b',
          fogColor: '#0f172a',
          fogDensity: 0.01 + 0.015 * clamped,
          particleCount: Math.round(140 * clamped),
          windSpeed: 0.15,
          tint: '#06b6d4',
          soundEffect: 'ambient_shimmer',
          sunIntensity: 0.2,
          particleType: 'stars',
          particleSpeed: 1.0,
        };
      case 'SAKURA_BLOSSOM':
        return {
          ambientColor: '#fce7f3',
          fogColor: '#fbcfe8',
          fogDensity: 0.004 + 0.006 * clamped,
          particleCount: Math.round(220 * clamped),
          windSpeed: 0.25 + 0.3 * clamped,
          tint: '#f472b6',
          soundEffect: 'ambient_breeze',
          sunIntensity: 0.9,
          particleType: 'petals',
          particleSpeed: 1.8 + 1.2 * clamped,
        };
      case 'SANDSTORM':
        return {
          ambientColor: '#d97706',
          fogColor: '#b45309',
          fogDensity: 0.02 + 0.05 * clamped,
          particleCount: Math.round(450 * clamped),
          windSpeed: 0.8 + 0.8 * clamped,
          tint: '#92400e',
          soundEffect: 'ambient_wind',
          sunIntensity: 0.45,
          particleType: 'dust',
          particleSpeed: 8 + 6 * clamped,
        };
      case 'FOG':
        return {
          ambientColor: '#94a3b8',
          fogColor: '#64748b',
          fogDensity: 0.035 + 0.045 * clamped,
          particleCount: Math.round(180 * clamped),
          windSpeed: 0.08,
          tint: '#475569',
          soundEffect: 'ambient_wind',
          sunIntensity: 0.3,
          particleType: 'mist',
          particleSpeed: 0.8,
        };
      case 'SUNNY':
      default:
        return {
          ambientColor: '#fffbe8',
          fogColor: '#e0f2fe',
          fogDensity: 0.002,
          particleCount: 0,
          windSpeed: 0.1,
          tint: '#ffffff',
          soundEffect: null,
          sunIntensity: 1.0,
          particleType: 'none',
          particleSpeed: 0,
        };
    }
  }

  /**
   * Interpolates between two atmospheric overlays for seamless lighting transitions
   */
  static interpolateOverlay(a: AtmosphericOverlay, b: AtmosphericOverlay, factor: number): AtmosphericOverlay {
    const t = Math.max(0, Math.min(1, factor));
    return {
      ambientColor: t < 0.5 ? a.ambientColor : b.ambientColor,
      fogColor: t < 0.5 ? a.fogColor : b.fogColor,
      fogDensity: a.fogDensity * (1 - t) + b.fogDensity * t,
      particleCount: Math.round(a.particleCount * (1 - t) + b.particleCount * t),
      windSpeed: Number((a.windSpeed * (1 - t) + b.windSpeed * t).toFixed(3)),
      tint: t < 0.5 ? a.tint : b.tint,
      soundEffect: t < 0.5 ? a.soundEffect : b.soundEffect,
      sunIntensity: Number(((a.sunIntensity ?? 1) * (1 - t) + (b.sunIntensity ?? 1) * t).toFixed(3)),
      particleType: t < 0.5 ? a.particleType : b.particleType,
      particleSpeed: Number(((a.particleSpeed ?? 0) * (1 - t) + (b.particleSpeed ?? 0) * t).toFixed(2)),
    };
  }

  /**
   * Evaluates valid transitions in the weather state machine
   */
  static getNextPossibleWeather(current: WorldWeather): WorldWeather[] {
    switch (current) {
      case 'SUNNY':
        return ['SUNNY', 'RAIN', 'AURORA', 'SAKURA_BLOSSOM', 'FOG'];
      case 'RAIN':
        return ['RAIN', 'SUNNY', 'SNOW', 'FOG'];
      case 'SNOW':
        return ['SNOW', 'SUNNY', 'RAIN', 'FOG'];
      case 'AURORA':
        return ['AURORA', 'SUNNY', 'SNOW'];
      case 'SAKURA_BLOSSOM':
        return ['SAKURA_BLOSSOM', 'SUNNY', 'RAIN'];
      case 'SANDSTORM':
        return ['SANDSTORM', 'SUNNY', 'FOG'];
      case 'FOG':
        return ['FOG', 'SUNNY', 'RAIN', 'SNOW'];
      default:
        return ['SUNNY'];
    }
  }

  /**
   * Sets current weather condition, calculates overlay, and broadcasts to all connected clients
   */
  static setWeather(weather: WorldWeather, intensity: number = 0.5): WeatherState {
    this.currentWeather = weather;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.changedAt = Date.now();

    const state = this.getWeather();
    const io = getIO();
    if (io) {
      io.emit(SOCKET_EVENTS.WEATHER_UPDATE, state);
    }
    return state;
  }

  /**
   * Advances the weather cycle using state machine transitions
   */
  static transitionWeather(): WeatherState {
    const nextCandidates = this.getNextPossibleWeather(this.currentWeather);
    const chosen = nextCandidates[Math.floor(Math.random() * nextCandidates.length)];
    const newIntensity = 0.3 + Math.random() * 0.7;
    return this.setWeather(chosen, newIntensity);
  }

  static getWeather(): WeatherState {
    return {
      currentWeather: this.currentWeather,
      intensity: this.intensity,
      changedAt: this.changedAt,
      overlay: this.getAtmosphericOverlay(this.currentWeather, this.intensity),
    };
  }
}
