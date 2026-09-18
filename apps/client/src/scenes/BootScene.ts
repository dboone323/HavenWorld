import Phaser from 'phaser';
import { createAvatarAnimations } from '../entities/AvatarAnimations';

const MAPS = ['lobby', 'town-square', 'park', 'cafe', 'personal-room'];
const ATLAS_KEYS = ['avatars', 'furniture'];

/**
 * BootScene — asset preloader with teal progress bar.
 * Transitions to LoginScene when done.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // ── Progress bar ────────────────────────────────────────────────────────
    const barBg = this.add.rectangle(W / 2, H / 2, 400, 20, 0x222244).setOrigin(0.5);
    const bar   = this.add.rectangle(W / 2 - 200, H / 2, 0, 16, 0x4ecdc4).setOrigin(0, 0.5);
    const label = this.add.text(W / 2, H / 2 + 24, 'Loading…', {
      fontSize:   '14px',
      fontFamily: 'monospace',
      color:      '#aaaacc',
    }).setOrigin(0.5);

    this.load.on('progress', (v: number) => {
      bar.width = 396 * v;
      label.setText(`Loading… ${Math.round(v * 100)}%`);
    });

    // Suppress unused variable warnings
    void barBg;

    // ── Tilemaps ────────────────────────────────────────────────────────────
    for (const map of MAPS) {
      this.load.tilemapTiledJSON(map, `assets/maps/${map}.json`);
    }

    // ── Tilesets ────────────────────────────────────────────────────────────
    this.load.image('tileset-outdoor', 'assets/sprites/tilesets/outdoor.png');
    this.load.image('tileset-indoor',  'assets/sprites/tilesets/indoor.png');

    // ── Texture atlases ─────────────────────────────────────────────────────
    for (const key of ATLAS_KEYS) {
      const folder = key === 'avatars' ? 'avatar' : 'furniture';
      this.load.atlas(
        key,
        `assets/sprites/${folder}/atlas.png`,
        `assets/sprites/${folder}/atlas.json`,
      );
    }
  }

  create(): void {
    // Register avatar animations globally once atlas is loaded
    createAvatarAnimations(this.anims);
    this.scene.start('LoginScene');
  }
}
