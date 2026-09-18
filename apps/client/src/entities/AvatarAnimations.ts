import type Phaser from 'phaser';

export type AnimationDirection = 'down' | 'up' | 'left' | 'right';

/** Avatar layer keys (must match atlas frame names) */
export const AVATAR_LAYERS = [
  'body',
  'eyes',
  'hair',
  'top',
  'bottom',
  'shoes',
  'hat',
  'accessory',
  'shadow',
] as const;

export type AvatarLayer = typeof AVATAR_LAYERS[number];

const WALK_FRAME_COUNT = 8;
const IDLE_FRAME_COUNT = 2;
const WALK_FPS  = 8;
const IDLE_FPS  = 1;

/**
 * Register all walk-<dir> and idle-<dir> animations for every avatar layer.
 * Call once from BootScene after atlas is loaded.
 */
export function createAvatarAnimations(anims: Phaser.Animations.AnimationManager): void {
  const directions: AnimationDirection[] = ['down', 'up', 'left', 'right'];

  for (const layer of AVATAR_LAYERS) {
    for (const dir of directions) {
      // Walk cycle — 8 frames @ 8 fps, looping
      anims.create({
        key:        `${layer}-walk-${dir}`,
        frames:     buildFrames(anims, `${layer}-walk-${dir}`, WALK_FRAME_COUNT),
        frameRate:  WALK_FPS,
        repeat:     -1,
      });

      // Idle cycle — 2 frames @ 1 fps, looping
      anims.create({
        key:        `${layer}-idle-${dir}`,
        frames:     buildFrames(anims, `${layer}-idle-${dir}`, IDLE_FRAME_COUNT),
        frameRate:  IDLE_FPS,
        repeat:     -1,
      });
    }
  }
}

function buildFrames(
  anims: Phaser.Animations.AnimationManager,
  prefix: string,
  count: number,
): Phaser.Types.Animations.AnimationFrame[] {
  return anims.generateFrameNames('avatars', {
    prefix:  `${prefix}-`,
    start:   0,
    end:     count - 1,
    zeroPad: 2,
  });
}
