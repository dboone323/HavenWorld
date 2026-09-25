import * as BABYLON from '@babylonjs/core';
import { ChibiAtlasManager } from './ChibiAtlasManager';
import type { AvatarData } from '@havenworld/shared';

export type ChibiAction = 'idle' | 'walk' | 'sit';
export type ChibiDirection = 'down' | 'up' | 'left' | 'right';

export class ChibiBillboard {
  public mesh: BABYLON.Mesh;
  private scene: BABYLON.Scene;
  private dynamicTexture: BABYLON.DynamicTexture;
  private material: BABYLON.StandardMaterial;
  private currentAction: ChibiAction = 'idle';
  private currentDirection: ChibiDirection = 'down';
  private currentFrame = 0;
  private avatarData?: AvatarData;

  constructor(name: string, scene: BABYLON.Scene, parent?: BABYLON.Node | null) {
    this.scene = scene;

    this.mesh = BABYLON.MeshBuilder.CreatePlane(name, { width: 1.35, height: 1.8 }, scene);
    if (parent) {
      this.mesh.parent = parent;
    }
    this.mesh.position.y = 0.9;
    this.mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    this.mesh.isPickable = true;

    this.dynamicTexture = new BABYLON.DynamicTexture(
      `${name}_tex`,
      { width: 96, height: 128 },
      scene,
      false,
      BABYLON.Constants.TEXTURE_NEAREST_SAMPLINGMODE
    );
    this.dynamicTexture.hasAlpha = true;

    this.material = new BABYLON.StandardMaterial(`${name}_mat`, scene);
    this.material.diffuseTexture = this.dynamicTexture;
    this.material.diffuseTexture.hasAlpha = true;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    this.material.disableLighting = true; // Crisp pixel art without 3D darkening
    this.material.specularColor = new BABYLON.Color3(0, 0, 0);
    this.material.backFaceCulling = false;
    this.mesh.material = this.material;

    this.initAtlas();
  }

  private async initAtlas(): Promise<void> {
    const atlas = ChibiAtlasManager.getInstance();
    await atlas.load();
    this.render();
  }

  public setAction(action: ChibiAction, direction: ChibiDirection, frameIndex: number = 0): void {
    this.currentAction = action;
    this.currentDirection = direction;
    this.currentFrame = frameIndex;
    this.mesh.position.y = action === 'sit' ? 0.65 : 0.9;
    this.render();
  }

  public setAvatarData(data: AvatarData): void {
    this.avatarData = data;
    this.render();
  }

  public render(): void {
    const atlas = ChibiAtlasManager.getInstance();
    const img = atlas.getImage();
    if (!img) return;

    try {
      const ctx = this.dynamicTexture.getContext() as CanvasRenderingContext2D;
      if (!ctx) return;
      ctx.clearRect(0, 0, 96, 128);
      ctx.imageSmoothingEnabled = false;

      // Draw layers in z-order: shadow, body, eyes, bottom, top, shoes, hair, hat, accessory
      const layers: Array<'shadow' | 'body' | 'eyes' | 'bottom' | 'top' | 'shoes' | 'hair' | 'hat' | 'accessory'> = [
        'shadow',
        'body',
        'eyes',
        'bottom',
        'top',
        'shoes',
        'hair',
        'hat',
        'accessory',
      ];

      for (const layer of layers) {
        if (layer === 'hat' && (!this.avatarData?.outfitHead || this.avatarData?.outfitHead === 'none')) {
          continue;
        }
        if (layer === 'accessory' && (!this.avatarData?.outfitFace && !this.avatarData?.outfitHand)) {
          continue;
        }
        const key = atlas.resolveFrameKey(layer, this.currentAction, this.currentDirection, this.currentFrame);
        const f = atlas.getFrame(key);
        if (f) {
          ctx.drawImage(img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, 96, 128);
        }
      }

      this.dynamicTexture.update();
    } catch {
      // In headless or test contexts where 2D canvas is restricted, silently skip update
    }
  }

  public dispose(): void {
    this.dynamicTexture.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
