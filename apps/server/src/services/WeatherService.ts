import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export type WorldWeather = 'SUNNY' | 'RAIN' | 'AURORA' | 'SNOW';

export interface AtmosphericOverlay {
  ambientColor: string;
  fogDensity: number;
  particleCount: number;
  windSpeed: number;
  tint: string;
  soundEffect: string | null;
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
          fogDensity: 0.01 + 0.03 * clamped,
          particleCount: Math.round(500 * clamped),
          windSpeed: 0.3 + 0.5 * clamped,
          tint: '#334155',
          soundEffect: 'ambient_rain',
        };
      case 'SNOW':
        return {
          ambientColor: '#cbd5e1',
          fogDensity: 0.02 + 0.04 * clamped,
          particleCount: Math.round(300 * clamped),
          windSpeed: 0.1 + 0.4 * clamped,
          tint: '#e2e8f0',
          soundEffect: 'ambient_wind',
        };
      case 'AURORA':
        return {
          ambientColor: '#1e1b4b',
          fogDensity: 0.01 + 0.015 * clamped,
          particleCount: Math.round(120 * clamped),
          windSpeed: 0.15,
          tint: '#06b6d4',
          soundEffect: 'ambient_shimmer',
        };
      case 'SUNNY':
      default:
        return {
          ambientColor: '#fffbe8',
          fogDensity: 0.002,
          particleCount: 0,
          windSpeed: 0.1,
          tint: '#ffffff',
          soundEffect: null,
        };
    }
  }

  /**
   * Evaluates valid transitions in the weather state machine
   */
  static getNextPossibleWeather(current: WorldWeather): WorldWeather[] {
    switch (current) {
      case 'SUNNY':
        return ['SUNNY', 'RAIN', 'AURORA'];
      case 'RAIN':
        return ['RAIN', 'SUNNY', 'SNOW'];
      case 'SNOW':
        return ['SNOW', 'SUNNY', 'RAIN'];
      case 'AURORA':
        return ['AURORA', 'SUNNY'];
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
