import * as BABYLON from '@babylonjs/core';
import type { MoodId } from '@havenworld/shared';

export interface MoodConfig {
  id: MoodId;
  name: string;
  ambientColor: string;
  sunColor: string;
  sunIntensity: number;
  fogColor?: string;
  fogDensity?: number;
  clearColor: string;
}

export const MOOD_PRESETS: Record<MoodId, MoodConfig> = {
  day: {
    id: 'day',
    name: 'Daylight',
    ambientColor: '#ffffff',
    sunColor: '#ffffff',
    sunIntensity: 1.0,
    clearColor: '#141426',
  },
  dusk: {
    id: 'dusk',
    name: 'Twilight Dusk',
    ambientColor: '#FF8C42',
    sunColor: '#FF6B35',
    sunIntensity: 0.6,
    clearColor: '#2b1a29',
  },
  night: {
    id: 'night',
    name: 'Midnight',
    ambientColor: '#1a1a4e',
    sunColor: '#303080',
    sunIntensity: 0.3,
    clearColor: '#080814',
  },
  cyber_neon: {
    id: 'cyber_neon',
    name: 'Cyber Neon',
    ambientColor: '#0a0a0a',
    sunColor: '#00ffff',
    sunIntensity: 0.4,
    clearColor: '#05050f',
  },
  golden_hour: {
    id: 'golden_hour',
    name: 'Golden Hour',
    ambientColor: '#FFD700',
    sunColor: '#FFA500',
    sunIntensity: 0.8,
    clearColor: '#332211',
  },
  haunted: {
    id: 'haunted',
    name: 'Haunted Mansion',
    ambientColor: '#2d4a2d',
    sunColor: '#3d633d',
    sunIntensity: 0.25,
    clearColor: '#0d1a0d',
  },
  arctic: {
    id: 'arctic',
    name: 'Arctic Chill',
    ambientColor: '#cce8ff',
    sunColor: '#e0f0ff',
    sunIntensity: 0.9,
    clearColor: '#122030',
  },
  cozy_evening: {
    id: 'cozy_evening',
    name: 'Cozy Fireplace',
    ambientColor: '#c47a3d',
    sunColor: '#e05a20',
    sunIntensity: 0.5,
    clearColor: '#241008',
  },
};

export class MoodSystem {
  private scene: BABYLON.Scene;
  private currentMood: MoodId = 'day';

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  applyMood(moodId: MoodId, smooth = true): void {
    const config = MOOD_PRESETS[moodId] || MOOD_PRESETS.day;
    this.currentMood = moodId;

    const ambientLight = this.scene.getLightByName('ambientLight') as BABYLON.HemisphericLight | null;
    const sunLight = this.scene.getLightByName('sunLight') as BABYLON.DirectionalLight | null;

    const targetAmbient = BABYLON.Color3.FromHexString(config.ambientColor);
    const targetSun = BABYLON.Color3.FromHexString(config.sunColor);
    const targetClear = BABYLON.Color4.FromHexString(config.clearColor + 'FF');

    if (!smooth) {
      if (ambientLight) ambientLight.diffuse = targetAmbient;
      if (sunLight) {
        sunLight.diffuse = targetSun;
        sunLight.intensity = config.sunIntensity;
      }
      this.scene.clearColor = targetClear;
      return;
    }

    // 2-second smooth transitions
    const frameRate = 30;
    const totalFrames = 60; // 2 seconds

    if (ambientLight) {
      BABYLON.Animation.CreateAndStartAnimation(
        'mood_ambient_anim',
        ambientLight,
        'diffuse',
        frameRate,
        totalFrames,
        ambientLight.diffuse,
        targetAmbient,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
    }

    if (sunLight) {
      BABYLON.Animation.CreateAndStartAnimation(
        'mood_sun_color_anim',
        sunLight,
        'diffuse',
        frameRate,
        totalFrames,
        sunLight.diffuse,
        targetSun,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      BABYLON.Animation.CreateAndStartAnimation(
        'mood_sun_intensity_anim',
        sunLight,
        'intensity',
        frameRate,
        totalFrames,
        sunLight.intensity,
        config.sunIntensity,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
    }
  }

  get activeMood(): MoodId {
    return this.currentMood;
  }
}
