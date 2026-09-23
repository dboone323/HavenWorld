import { getIO } from '../sockets';

export type WorldWeather = 'SUNNY' | 'RAIN' | 'AURORA' | 'SNOW';

export interface WeatherState {
  currentWeather: WorldWeather;
  intensity: number; // 0.0 to 1.0
  changedAt: number;
}

export class WeatherService {
  private static currentWeather: WorldWeather = 'SUNNY';
  private static intensity: number = 0.5;
  private static changedAt: number = Date.now();

  /**
   * Sets current weather condition and broadcasts to all connected clients
   */
  static setWeather(weather: WorldWeather, intensity: number = 0.5): WeatherState {
    this.currentWeather = weather;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.changedAt = Date.now();

    const state = this.getWeather();
    const io = getIO();
    if (io) {
      io.emit('weather:update', state);
    }
    return state;
  }

  static getWeather(): WeatherState {
    return {
      currentWeather: this.currentWeather,
      intensity: this.intensity,
      changedAt: this.changedAt,
    };
  }
}
