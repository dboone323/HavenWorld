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
  private beforeRenderObserver: (() => void) | null = null;

  constructor(name: string, scene: BABYLON.Scene, parent?: BABYLON.Node | null) {
    this.scene = scene;

    // Calibrated to MiPlanet 133:227 aspect ratio with prominent scaled presence (1.78 x 3.05)
    this.mesh = BABYLON.MeshBuilder.CreatePlane(name, { width: 1.78, height: 3.05 }, scene);
    this.mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    this.mesh.isPickable = true;

    if (parent) {
      const parentNode = parent;
      const followObserver = () => {
        if (!this.mesh || this.mesh.isDisposed()) return;
        if (!parentNode || (parentNode as any).isDisposed?.()) return;
        const p = (parentNode as BABYLON.AbstractMesh).getAbsolutePosition
          ? (parentNode as BABYLON.AbstractMesh).getAbsolutePosition()
          : (parentNode as any).position;
        if (p) {
          const yOffset = this.currentAction === 'sit' ? 1.05 : 1.525;
          this.mesh.position.set(p.x, p.y + yOffset, p.z);
        }
      };
      scene.registerBeforeRender(followObserver);
      this.beforeRenderObserver = followObserver;
      followObserver();
    } else {
      this.mesh.position.y = 1.525;
    }

    this.dynamicTexture = new BABYLON.DynamicTexture(
      `${name}_tex`,
      { width: 256, height: 340 },
      scene,
      false,
      BABYLON.Constants.TEXTURE_BILINEAR_SAMPLINGMODE
    );
    this.dynamicTexture.hasAlpha = true;

    this.material = new BABYLON.StandardMaterial(`${name}_mat`, scene);
    this.material.diffuseTexture = this.dynamicTexture;
    this.material.diffuseTexture.hasAlpha = true;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATESTANDBLEND;
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

  public updatePosition(pos: BABYLON.Vector3, isSitting = false): void {
    if (!this.mesh || this.mesh.isDisposed()) return;
    const yOffset = isSitting || this.currentAction === 'sit' ? 1.05 : 1.525;
    this.mesh.position.set(pos.x, pos.y + yOffset, pos.z);
  }

  public setAction(action: ChibiAction, direction: ChibiDirection, frameIndex: number = 0): void {
    if (
      this.currentAction === action &&
      this.currentDirection === direction &&
      this.currentFrame === frameIndex
    ) {
      return;
    }
    this.currentAction = action;
    this.currentDirection = direction;
    this.currentFrame = frameIndex;
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
      const texSize = this.dynamicTexture.getSize();
      const w = texSize.width;
      const h = texSize.height;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

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
        if (layer === 'top' && (this.avatarData?.outfitBody === 'none' || this.avatarData?.outfitBody === 'underwear' || this.avatarData?.top === 'none')) {
          continue;
        }
        if (layer === 'bottom' && (this.avatarData?.outfitLegs === 'none' || this.avatarData?.outfitLegs === 'underwear' || this.avatarData?.bottom === 'none')) {
          continue;
        }
        if (layer === 'shoes' && (this.avatarData?.outfitFeet === 'none' || this.avatarData?.shoes === 'none')) {
          continue;
        }
        if (layer === 'hair' && (this.avatarData?.hairStyle === 'none' || this.avatarData?.hairStyle === 'bald' || this.avatarData?.hair === 'none')) {
          continue;
        }
        const key = atlas.resolveFrameKey(layer, this.currentAction, this.currentDirection, this.currentFrame);
        const f = atlas.getFrame(key);
        if (f) {
          ctx.drawImage(img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, w, h);
        }
      }

      this.dynamicTexture.update();
    } catch {
      // In headless or test contexts where 2D canvas is restricted, silently skip update
    }
  }

  public dispose(): void {
    if (this.beforeRenderObserver) {
      this.scene.unregisterBeforeRender(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    this.dynamicTexture.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
