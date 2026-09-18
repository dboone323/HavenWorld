import Phaser from 'phaser';
import type { AvatarData, Direction } from '@shared/types';
import { AVATAR_LAYERS } from './AvatarAnimations';

const NAMETAG_Y_OFFSET  = -64;
const BUBBLE_Y_OFFSET   = -80;
const BUBBLE_DURATION   = 4000; // ms

/**
 * Avatar — a 9-layer Phaser Container.
 *
 * Layer render order (bottom → top):
 *   shadow, body, eyes, shoes, bottom, top, hair, hat, accessory
 *
 * Also contains a nametag (Phaser.GameObjects.Text) and an auto-expiring
 * speech bubble (Phaser.GameObjects.Text).
 */
export class Avatar extends Phaser.GameObjects.Container {
  private readonly layers: Record<string, Phaser.GameObjects.Sprite> = {};
  private readonly nametag:  Phaser.GameObjects.Text;
  private readonly bubble:   Phaser.GameObjects.Text;

  private _direction: Direction = 'down';
  private _moving    = false;
  private _bubbleTimer: ReturnType<typeof setTimeout> | null = null;

  // Render order: index 0 is drawn first (bottom)
  private static readonly LAYER_ORDER = [
    'shadow',
    'body',
    'eyes',
    'shoes',
    'bottom',
    'top',
    'hair',
    'hat',
    'accessory',
  ] as const;

  constructor(
    scene:    Phaser.Scene,
    x:        number,
    y:        number,
    username: string,
    avatar?:  AvatarData | null,
  ) {
    super(scene, x, y);

    // Build layer sprites in render order
    for (const layer of Avatar.LAYER_ORDER) {
      const sprite = scene.add.sprite(0, 0, 'avatars', `${layer}-idle-down-00`);
      sprite.setOrigin(0.5, 1);
      this.layers[layer] = sprite;
      this.add(sprite);
    }

    // Nametag
    this.nametag = scene.add.text(0, NAMETAG_Y_OFFSET, username, {
      fontSize:        '11px',
      fontFamily:      'monospace',
      color:           '#ffffff',
      backgroundColor: '#00000066',
      padding:         { x: 4, y: 2 },
    }).setOrigin(0.5, 1);
    this.add(this.nametag);

    // Speech bubble (hidden by default)
    this.bubble = scene.add.text(0, BUBBLE_Y_OFFSET, '', {
      fontSize:        '11px',
      fontFamily:      'monospace',
      color:           '#1a1a2e',
      backgroundColor: '#ffffffe0',
      padding:         { x: 6, y: 3 },
      wordWrap:        { width: 180 },
    }).setOrigin(0.5, 1).setVisible(false);
    this.add(this.bubble);

    // Apply initial avatar skin-tone / layer visibility
    this.updateAvatar(avatar);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  get direction(): Direction { return this._direction; }

  playWalk(dir: Direction): void {
    if (this._moving && this._direction === dir) return;
    this._direction = dir;
    this._moving    = true;
    for (const layer of AVATAR_LAYERS) {
      this.layers[layer]?.play(`${layer}-walk-${dir}`, true);
    }
  }

  stopWalk(dir?: Direction): void {
    this._moving = false;
    const d = dir ?? this._direction;
    for (const layer of AVATAR_LAYERS) {
      this.layers[layer]?.play(`${layer}-idle-${d}`, true);
    }
  }

  showSpeechBubble(text: string): void {
    this.bubble.setText(text).setVisible(true);
    this.bubble.setY(BUBBLE_Y_OFFSET - this.nametag.displayHeight - 4);
    if (this._bubbleTimer) clearTimeout(this._bubbleTimer);
    this._bubbleTimer = setTimeout(() => {
      this.bubble.setVisible(false);
    }, BUBBLE_DURATION);
  }

  updateAvatar(avatar?: AvatarData | null): void {
    // Set tint / frame based on skin-tone for the body layer
    // (In a real build, skins map to atlas variants; here we use tint)
    const bodyLayer = this.layers['body'];
    if (bodyLayer) {
      const tintMap: Record<string, number> = {
        light:    0xffe0bd,
        medium:   0xd4a76a,
        tan:      0xc68642,
        dark:     0x8d5524,
        deep:     0x4a2912,
      };
      const skinTone = avatar?.skinTone ?? 'light';
      const tint = tintMap[skinTone] ?? 0xffe0bd;
      bodyLayer.setTint(tint);
    }
  }

  setDepthByY(): void {
    this.setDepth(this.y);
  }

  override destroy(fromScene?: boolean): void {
    if (this._bubbleTimer) clearTimeout(this._bubbleTimer);
    super.destroy(fromScene);
  }
}
