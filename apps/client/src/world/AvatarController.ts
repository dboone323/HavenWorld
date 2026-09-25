import * as BABYLON from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';
import type { AvatarData } from '@havenworld/shared';
import { getItemAccentColor, normalizeGender, SOCKET_EVENTS } from '@havenworld/shared';
import { socketService } from '../services/socket';
import { assetUrl } from '../config';

const AVATAR_GLB_PATH = '/assets/avatars/';
const AVATAR_GLB_FILE = 'base_avatar.glb';
const WALK_SPEED = 3.5; // meters per second
const ARRIVAL_THRESHOLD = 0.15; // stop walking when within 15cm

import { ChibiBillboard, type ChibiDirection } from './ChibiBillboard';

export interface UserProfile {
  id: string;
  username: string;
  avatarData?: AvatarData;
}

export class AvatarController {
  public rootMesh: BABYLON.AbstractMesh | null = null;
  public roomId: string = 'main';
  public isMoving = false;
  public targetPosition: BABYLON.Vector3 | null = null;
  public currentAnimName = 'idle';

  public isPlaceholder = false;
  public chibiBillboard: ChibiBillboard | null = null;
  private chibiDirection: ChibiDirection = 'down';
  private chibiAnimTimer: number = 0;
  private chibiWalkFrame: number = 0;

  private scene: BABYLON.Scene;
  private user: UserProfile;
  private skeleton: BABYLON.Skeleton | null = null;
  private morphManagers: BABYLON.MorphTargetManager[] = [];
  private animations: Map<string, BABYLON.AnimationGroup> = new Map();
  private currentAnim: BABYLON.AnimationGroup | null = null;
  private blendTimer: number | null = null;
  private readonly BLEND_FRAMES = 9; // ~0.3s at 30fps

  private nameTagTexture: AdvancedDynamicTexture | null = null;
  private nameTagMesh: BABYLON.AbstractMesh | null = null;
  private renderObserver: (() => void) | null = null;

  constructor(scene: BABYLON.Scene, user: UserProfile) {
    this.scene = scene;
    this.user = user;
  }

  public get position(): BABYLON.Vector3 {
    return this.rootMesh?.position ?? BABYLON.Vector3.Zero();
  }

  public addMorphTargetManager(manager: BABYLON.MorphTargetManager): void {
    this.morphManagers.push(manager);
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  async init(spawnPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero()): Promise<void> {
    await this.load(spawnPosition);
  }

  async load(spawnPosition: BABYLON.Vector3): Promise<void> {
    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        '',
        assetUrl(AVATAR_GLB_PATH),
        AVATAR_GLB_FILE,
        this.scene
      );

      if (!result.meshes.length) {
        throw new Error('[AvatarController] GLB loaded but contained no meshes.');
      }

      this.isPlaceholder = false;
      this.rootMesh = result.meshes[0];
      this.rootMesh.name = `avatar_local_${this.user.id}`;
      this.rootMesh.position = spawnPosition.clone();
      this.rootMesh.rotationQuaternion = null; // Enable Euler rotation.y control

      // Collect morph target managers from all sub-meshes
      for (const mesh of result.meshes) {
        if (mesh.morphTargetManager) {
          this.morphManagers.push(mesh.morphTargetManager);
        }
      }

      if (result.skeletons.length > 0) {
        this.skeleton = result.skeletons[0];
      }

      this.initAnimations(result.animationGroups);
    } catch {
      this.isPlaceholder = true;
      this.buildPlaceholder(spawnPosition);
    }

    try {
      this.chibiBillboard = new ChibiBillboard(`chibi_avatar_local_${this.user.id}`, this.scene, this.rootMesh);
      if (this.user.avatarData) {
        this.chibiBillboard.setAvatarData(this.user.avatarData);
      }
      this.chibiBillboard.setAction('idle', 'down', 0);
    } catch {
      // In non-canvas/headless test environments, ChibiBillboard fails gracefully
    }

    if (this.user.avatarData) {
      this.applyCustomization(this.user.avatarData);
    }

    this.attachNameTag();
    this.registerUpdateLoop();
  }

  private buildPlaceholder(spawnPosition: BABYLON.Vector3): void {
    const body = BABYLON.MeshBuilder.CreateCapsule(
      `avatar_local_${this.user.id}`,
      { radius: 0.25, height: 1.7, tessellation: 8 },
      this.scene
    );
    body.position = spawnPosition.clone();
    body.rotationQuaternion = null;

    const head = BABYLON.MeshBuilder.CreateSphere(
      'avatar_head',
      { diameter: 0.4, segments: 8 },
      this.scene
    );
    head.parent = body;
    head.position.y = 1.1;

    const mat = new BABYLON.StandardMaterial('avatar_mat', this.scene);
    const skinHex = (this.user.avatarData?.skinTone as string) || (this.user.avatarData?.skinColor as string) || '#F5CBA7';
    mat.diffuseColor = BABYLON.Color3.FromHexString(skinHex);
    body.material = mat;
    head.material = mat;

    // In a browser with canvas support, the 2D Chibi billboard is our primary visual avatar!
    // We set placeholder capsule/head visibility to 0 so they act as invisible collision/picking hitboxes.
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      body.visibility = 0;
      head.visibility = 0;
    }

    body.metadata = { isLocalAvatar: true, userId: this.user.id, username: this.user.username };
    head.metadata = { isLocalAvatar: true, userId: this.user.id, username: this.user.username };

    this.rootMesh = body;
  }

  private onArrivalCallback: (() => void) | null = null;

  public lookAt(targetPoint: BABYLON.Vector3): void {
    if (!this.rootMesh) return;
    const dirX = targetPoint.x - this.rootMesh.position.x;
    const dirZ = targetPoint.z - this.rootMesh.position.z;
    if (Math.hypot(dirX, dirZ) > 0.001) {
      this.rootMesh.rotationQuaternion = null;
      this.rootMesh.rotation.y = Math.atan2(dirX, dirZ);
    }
  }

  public faceDirection(dir: BABYLON.Vector3): void {
    if (!this.rootMesh) return;
    if (Math.hypot(dir.x, dir.z) > 0.001) {
      this.rootMesh.rotationQuaternion = null;
      this.rootMesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
  }

  moveTo(target: BABYLON.Vector3, onArrival?: () => void): void {
    if (this.currentAnimName === 'sit' && this.rootMesh) {
      this.rootMesh.position.y = 0;
      this.currentAnimName = 'idle';
      this.chibiBillboard?.setAction('idle', this.chibiDirection, 0);
      const roomId =
        (typeof window !== 'undefined' && (window as unknown as Record<string, string>).__havenRoomId) ||
        this.roomId;
      socketService.emit(SOCKET_EVENTS.PLAYER_SIT, {
        roomId,
        x: this.rootMesh.position.x,
        y: 0,
        z: this.rootMesh.position.z,
        rotY: this.rootMesh.rotation.y,
        isSitting: false,
      });
    }
    this.targetPosition = new BABYLON.Vector3(target.x, 0, target.z);
    this.onArrivalCallback = onArrival || null;
    this.isMoving = true;
    this.lookAt(this.targetPosition);
    this.crossFadeTo('walk');
  }

  public sitOn(seatMesh: BABYLON.AbstractMesh): void {
    if (!this.rootMesh) return;
    seatMesh.computeWorldMatrix(true);
    const seatPos = seatMesh.getAbsolutePosition();
    this.playSocialAnim('sit');
    this.rootMesh.position.x = seatPos.x;
    this.rootMesh.position.z = seatPos.z;
    this.rootMesh.position.y = (seatPos.y || 0) + 0.12;
    this.rootMesh.rotationQuaternion = null;
    if (seatMesh.rotation) {
      this.rootMesh.rotation.y = seatMesh.rotation.y;
    }
    this.chibiBillboard?.setAction('sit', 'down', 0);

    const roomId =
      (typeof window !== 'undefined' && (window as unknown as Record<string, string>).__havenRoomId) ||
      this.roomId;
    socketService.emit(SOCKET_EVENTS.PLAYER_SIT, {
      roomId,
      seatId: seatMesh.name,
      x: this.rootMesh.position.x,
      y: this.rootMesh.position.y,
      z: this.rootMesh.position.z,
      rotY: this.rootMesh.rotation.y,
      isSitting: true,
    });
  }

  playSocialAnim(name: 'sit' | 'wave' | 'dance'): void {
    this.targetPosition = null;
    this.onArrivalCallback = null;
    this.isMoving = false;
    this.currentAnimName = name;
    if (name === 'sit') {
      if (this.rootMesh) {
        this.rootMesh.position.y = -0.32;
      }
      this.chibiBillboard?.setAction('sit', 'down', 0);
    } else {
      this.chibiBillboard?.setAction('idle', this.chibiDirection, 0);
    }
    this.crossFadeTo(name, name !== 'wave'); // wave does not loop
  }

  applyCustomization(data: AvatarData): void {
    this.applyMorphTargets(data);
    this.applyMaterialColors(data);
    this.applyOutfit(data);
    this.chibiBillboard?.setAvatarData(data);
  }

  // ─── Wardrobe Layers ─────────────────────────────────────────────────────
  /**
   * Renders the equipped wardrobe as tinted 3D layers parented to the avatar root:
   * hair (driven by `hairStyle`), top (`outfitBody`), pants (`outfitLegs`) and
   * shoes (`outfitFeet`). Until per-item GLBs ship, each layer is a procedural
   * primitive tinted with the item's accent colour, so equipped items are visually
   * distinct and stay in sync through the existing `avatar:changed` broadcast.
   * Gender proportions shape shoulders (male) vs. hips (female).
   */
  public applyOutfit(data: AvatarData): void {
    if (!this.rootMesh) return;

    if (!this.isPlaceholder) {
      // Rigged GLB avatar is active.
      // Ensure any placeholder wardrobe meshes are disabled so they do not duplicate the 3D body.
      for (const part of ['hair', 'top', 'pants', 'shoe_l', 'shoe_r']) {
        const layer = this.scene.getMeshByName(this.layerName(part));
        if (layer) layer.setEnabled(false);
      }
      const hairMesh = this.scene.getMeshByName('avatar_hair');
      if (hairMesh) {
        hairMesh.setEnabled(data.hairStyle !== 'none' && data.hairStyle !== 'bald');
      }
      return;
    }

    const gender = normalizeGender(data.gender);
    const shoulderScale = gender === 'male' ? 1.12 : gender === 'female' ? 0.96 : 1;
    const hipScale = gender === 'male' ? 0.94 : gender === 'female' ? 1.1 : 1;

    const hairStyle = typeof data.hairStyle === 'string' ? data.hairStyle : null;
    const hairColor = (data.hairColor as string) || getItemAccentColor(hairStyle, '#3B2314');
    const isLongHair = Boolean(hairStyle && hairStyle.includes('long'));

    this.upsertLayer(
      this.layerName('hair'),
      () => BABYLON.MeshBuilder.CreateSphere(this.layerName('hair'), { diameter: 0.46, segments: 8 }, this.scene),
      {
        position: new BABYLON.Vector3(0, 1.12, 0),
        scaling: new BABYLON.Vector3(1.05, isLongHair ? 1.35 : 0.72, 1.05),
        color: hairColor,
        enabled: Boolean(hairStyle),
      }
    );

    this.upsertLayer(
      this.layerName('top'),
      () =>
        BABYLON.MeshBuilder.CreateBox(
          this.layerName('top'),
          { width: 0.5, height: 0.55, depth: 0.3 },
          this.scene
        ),
      {
        position: new BABYLON.Vector3(0, 0.62, 0),
        scaling: new BABYLON.Vector3(shoulderScale, 1, 1),
        color: getItemAccentColor(data.outfitBody, (data.topColor as string) || '#4169E1'),
        enabled: Boolean(data.outfitBody),
      }
    );

    this.upsertLayer(
      this.layerName('pants'),
      () =>
        BABYLON.MeshBuilder.CreateBox(
          this.layerName('pants'),
          { width: 0.44, height: 0.5, depth: 0.28 },
          this.scene
        ),
      {
        position: new BABYLON.Vector3(0, 0.16, 0),
        scaling: new BABYLON.Vector3(hipScale, 1, 1),
        color: getItemAccentColor(data.outfitLegs, (data.bottomColor as string) || '#2E8B57'),
        enabled: Boolean(data.outfitLegs),
      }
    );

    for (const side of ['l', 'r'] as const) {
      const offset = side === 'l' ? 0.12 : -0.12;
      this.upsertLayer(
        this.layerName(`shoe_${side}`),
        () =>
          BABYLON.MeshBuilder.CreateBox(
            this.layerName(`shoe_${side}`),
            { width: 0.16, height: 0.1, depth: 0.28 },
            this.scene
          ),
        {
          position: new BABYLON.Vector3(offset, -0.02, 0.04),
          scaling: new BABYLON.Vector3(1, 1, 1),
          color: getItemAccentColor(data.outfitFeet, '#1C1C1C'),
          enabled: Boolean(data.outfitFeet),
        }
      );
    }

    // Headwear (outfitHead)
    this.upsertLayer(
      this.layerName('hat'),
      () => BABYLON.MeshBuilder.CreateCylinder(this.layerName('hat'), { diameter: 0.52, height: 0.22, tessellation: 12 }, this.scene),
      {
        position: new BABYLON.Vector3(0, 1.34, 0),
        scaling: new BABYLON.Vector3(1, 1, 1),
        color: getItemAccentColor(data.outfitHead, '#1C1C1C'),
        enabled: Boolean(data.outfitHead),
      }
    );

    // Face / Glasses (outfitFace)
    this.upsertLayer(
      this.layerName('face'),
      () => BABYLON.MeshBuilder.CreateBox(this.layerName('face'), { width: 0.36, height: 0.1, depth: 0.05 }, this.scene),
      {
        position: new BABYLON.Vector3(0, 1.12, 0.21),
        scaling: new BABYLON.Vector3(1, 1, 1),
        color: getItemAccentColor(data.outfitFace, '#000000'),
        enabled: Boolean(data.outfitFace),
      }
    );

    // Back / Wings / Backpack (outfitBack)
    this.upsertLayer(
      this.layerName('back'),
      () => BABYLON.MeshBuilder.CreateBox(this.layerName('back'), { width: 0.42, height: 0.48, depth: 0.16 }, this.scene),
      {
        position: new BABYLON.Vector3(0, 0.62, -0.22),
        scaling: new BABYLON.Vector3(1, 1, 1),
        color: getItemAccentColor(data.outfitBack, '#8B4513'),
        enabled: Boolean(data.outfitBack),
      }
    );

    // Hand item (outfitHand)
    this.upsertLayer(
      this.layerName('hand'),
      () => BABYLON.MeshBuilder.CreateCylinder(this.layerName('hand'), { diameter: 0.06, height: 0.5, tessellation: 8 }, this.scene),
      {
        position: new BABYLON.Vector3(0.32, 0.45, 0.15),
        scaling: new BABYLON.Vector3(1, 1, 1),
        color: getItemAccentColor(data.outfitHand, '#FFD700'),
        enabled: Boolean(data.outfitHand),
      }
    );
  }

  /** Layer meshes are namespaced per avatar so multiple avatars coexist in a scene. */
  private layerName(part: string): string {
    return `avatar_${this.user.id}_${part}`;
  }

  private upsertLayer(
    meshName: string,
    create: () => BABYLON.Mesh,
    opts: {
      position: BABYLON.Vector3;
      scaling: BABYLON.Vector3;
      color: string;
      enabled: boolean;
    }
  ): void {
    if (!this.rootMesh) return;

    let mesh = this.scene.getMeshByName(meshName) as BABYLON.Mesh | null;
    if (!mesh) {
      mesh = create();
      mesh.parent = this.rootMesh;
      mesh.isPickable = false;
      const material = new BABYLON.StandardMaterial(`${meshName}_mat`, this.scene);
      mesh.material = material;
    }

    const material = mesh.material as BABYLON.StandardMaterial | null;
    if (material) {
      try {
        material.diffuseColor = BABYLON.Color3.FromHexString(opts.color);
      } catch {
        // Malformed hex from an old save — keep the previous colour.
      }
    }

    mesh.position = opts.position;
    mesh.scaling = opts.scaling;
    mesh.setEnabled(opts.enabled);
  }

  // ─── Morph Targets ────────────────────────────────────────────────────────
  public applyMorphTargets(data: AvatarData): void {
    const bodyType = typeof data.bodyType === 'number' ? data.bodyType : 0.5;
    const height = typeof data.height === 'number' ? data.height : 0.5;
    const build = typeof data.build === 'number' ? data.build : 0.5;

    for (const manager of this.morphManagers) {
      for (let i = 0; i < manager.numTargets; i++) {
        const target = manager.getTarget(i);
        switch (target.name.toLowerCase()) {
          case 'fat':
            target.influence = Math.max(0, (bodyType - 0.5) * 2);
            break;
          case 'thin':
            target.influence = Math.max(0, (0.5 - bodyType) * 2);
            break;
          case 'tall':
            target.influence = Math.max(0, (height - 0.5) * 2);
            break;
          case 'short':
            target.influence = Math.max(0, (0.5 - height) * 2);
            break;
          case 'muscular':
            target.influence = Math.max(0, build);
            break;
        }
      }
    }
  }

  // ─── Material Colors ──────────────────────────────────────────────────────
  public applyMaterialColors(data: AvatarData): void {
    const skinHex = data.skinTone || (data.skinColor as string);
    if (skinHex && this.rootMesh?.material) {
      const mat = this.rootMesh.material as BABYLON.StandardMaterial;
      if (mat.diffuseColor) {
        mat.diffuseColor = BABYLON.Color3.FromHexString(skinHex);
      }
    }

    const hairStyle = typeof data.hairStyle === 'string' ? data.hairStyle : null;
    const hairHex = (data.hairColor as string) || (hairStyle ? getItemAccentColor(hairStyle, '#1C1C1C') : undefined);
    const topHex = (data.topColor as string) || (data.outfitBody ? getItemAccentColor(data.outfitBody, '#4169E1') : undefined);
    const bottomHex = (data.bottomColor as string) || (data.outfitLegs ? getItemAccentColor(data.outfitLegs, '#2E8B57') : undefined);

    const colorMap: Record<string, string | undefined> = {
      mat_skin: skinHex,
      mat_hair: hairHex,
      mat_eyes: data.eyeColor,
      mat_shirt: topHex,
      mat_pants: bottomHex,
    };

    for (const [matName, hexColor] of Object.entries(colorMap)) {
      if (!hexColor) continue;
      const mat = this.scene.getMaterialByName(matName) as
        | BABYLON.PBRMaterial
        | BABYLON.StandardMaterial
        | null;
      if (mat) {
        if ('albedoColor' in mat) {
          (mat as BABYLON.PBRMaterial).albedoColor = BABYLON.Color3.FromHexString(hexColor);
        } else if ('diffuseColor' in mat) {
          (mat as BABYLON.StandardMaterial).diffuseColor = BABYLON.Color3.FromHexString(hexColor);
        }
      }
    }
  }

  // ─── Name Tag ─────────────────────────────────────────────────────────────
  private attachNameTag(): void {
    if (!this.rootMesh) return;
    const plane = BABYLON.MeshBuilder.CreatePlane(
      `nametag_${this.user.username}`,
      { width: 1.8, height: 0.4 },
      this.scene
    );
    plane.parent = this.rootMesh;
    plane.position = new BABYLON.Vector3(0, 2.3, 0); // above head
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;

    try {
      const testCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (!testCanvas || !testCanvas.getContext || !testCanvas.getContext('2d')) {
        this.nameTagMesh = plane;
        return;
      }
      this.nameTagTexture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 128);
      const bg = new Rectangle();
      bg.background = '#00000099';
      bg.cornerRadius = 8;
      bg.thickness = 0;
      bg.width = '100%';
      bg.height = '100%';
      this.nameTagTexture.addControl(bg);

      const label = new TextBlock();
      label.text = this.user.username;
      label.color = '#ffffff';
      label.fontSize = 32;
      label.fontFamily = 'Calibri, sans-serif';
      bg.addControl(label);
    } catch {
      // Graceful fallback in headless / NullEngine environments
    }

    this.nameTagMesh = plane;
  }

  // ─── Animation System ─────────────────────────────────────────────────────
  private initAnimations(animationGroups: BABYLON.AnimationGroup[]): void {
    const validNames = ['idle', 'walk', 'sit', 'wave', 'dance'];
    for (const group of animationGroups) {
      const name = group.name.toLowerCase().trim();
      if (validNames.includes(name)) {
        group.stop();
        group.setWeightForAllAnimatables(0);
        this.animations.set(name, group);
      }
    }

    this.animations.forEach((group) => group.play(true));
    this.crossFadeTo('idle');
  }

  playAnim(name: string, loop = true): void {
    this.crossFadeTo(name, loop);
  }

  public crossFadeTo(name: string, loop = true): void {
    this.currentAnimName = name;
    const incoming = this.animations.get(name);
    if (!incoming) {
      return;
    }

    const outgoing = this.currentAnim;
    this.currentAnim = incoming;

    if (this.blendTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.blendTimer);
    }

    let frame = 0;
    if (typeof window !== 'undefined') {
      this.blendTimer = window.setInterval(() => {
        const t = Math.min(frame / this.BLEND_FRAMES, 1);
        incoming.setWeightForAllAnimatables(t);
        if (outgoing && outgoing !== incoming) {
          outgoing.setWeightForAllAnimatables(1 - t);
        }
        frame++;
        if (frame > this.BLEND_FRAMES) {
          window.clearInterval(this.blendTimer!);
          this.blendTimer = null;
          if (outgoing && outgoing !== incoming) {
            outgoing.setWeightForAllAnimatables(0);
          }
        }
      }, 1000 / 30);
    }
  }

  private moveEmitTimer = 0;

  // ─── Movement Update Loop ─────────────────────────────────────────────────
  public updateMovement(): void {
    if (!this.rootMesh || !this.targetPosition || !this.isMoving) return;

    const current = this.rootMesh.position;
    const dir = this.targetPosition.subtract(current);
    dir.y = 0;
    const dist = dir.length();
    const dt = this.scene.getEngine().getDeltaTime();
    const delta = dt > 0 ? dt / 1000 : 1 / 60;

    if (dist < ARRIVAL_THRESHOLD) {
      this.rootMesh.position.copyFrom(this.targetPosition);
      this.isMoving = false;
      this.targetPosition = null;
      this.moveEmitTimer = 0;
      this.chibiAnimTimer = 0;
      this.chibiWalkFrame = 0;
      this.chibiBillboard?.setAction('idle', this.chibiDirection, 0);
      this.crossFadeTo('idle');

      // Confirm final position to server
      const roomId =
        (typeof window !== 'undefined' && (window as unknown as Record<string, string>).__havenRoomId) ||
        this.roomId;
      socketService.emit('player:move', {
        roomId,
        x: this.rootMesh.position.x,
        y: this.rootMesh.position.y,
        z: this.rootMesh.position.z,
        rotY: this.rootMesh.rotation.y,
      });

      if (this.onArrivalCallback) {
        const cb = this.onArrivalCallback;
        this.onArrivalCallback = null;
        cb();
      }
      return;
    }

    // Determine isometric direction for Chibi sprite
    if (Math.abs(dir.x) > Math.abs(dir.z)) {
      this.chibiDirection = dir.x > 0 ? 'right' : 'left';
    } else {
      this.chibiDirection = dir.z > 0 ? 'up' : 'down';
    }

    // Step walk frame every ~100ms
    this.chibiAnimTimer += dt;
    if (this.chibiAnimTimer >= 100) {
      this.chibiAnimTimer = 0;
      this.chibiWalkFrame = (this.chibiWalkFrame + 1) % 8;
      this.chibiBillboard?.setAction('walk', this.chibiDirection, this.chibiWalkFrame);
    }

    // Rotate toward target
    const angle = Math.atan2(dir.x, dir.z);
    this.rootMesh.rotationQuaternion = null;
    this.rootMesh.rotation.y = angle;

    // Move toward target
    const step = dir.normalize().scale(WALK_SPEED * delta);
    this.rootMesh.position.addInPlace(step);

    // Stream position updates at 10Hz for smooth multiplayer sync
    this.moveEmitTimer += dt;
    if (this.moveEmitTimer >= 100) {
      this.moveEmitTimer = 0;
      const roomId =
        (typeof window !== 'undefined' && (window as unknown as Record<string, string>).__havenRoomId) ||
        this.roomId;
      socketService.emit('player:move', {
        roomId,
        x: this.rootMesh.position.x,
        y: this.rootMesh.position.y,
        z: this.rootMesh.position.z,
        rotY: this.rootMesh.rotation.y,
      });
    }
  }

  private registerUpdateLoop(): void {
    const callback = () => this.updateMovement();
    this.scene.registerBeforeRender(callback);
    this.renderObserver = callback;
  }

  dispose(): void {
    if (this.blendTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.blendTimer);
    }
    if (this.renderObserver) {
      this.scene.unregisterBeforeRender(this.renderObserver);
      this.renderObserver = null;
    }
    this.chibiBillboard?.dispose();
    this.chibiBillboard = null;
    this.nameTagTexture?.dispose();
    this.nameTagMesh?.dispose();
    this.animations.forEach((ag) => ag.dispose());
    this.animations.clear();
    this.rootMesh?.dispose();
    this.rootMesh = null;
  }
}
