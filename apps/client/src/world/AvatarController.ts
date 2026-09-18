import * as BABYLON from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';
import type { AvatarData } from '@havenworld/shared';
import { socketService } from '../services/socket';

const AVATAR_GLB_PATH = '/assets/avatars/';
const AVATAR_GLB_FILE = 'base_avatar.glb';
const WALK_SPEED = 3.5; // meters per second
const ARRIVAL_THRESHOLD = 0.15; // stop walking when within 15cm

export interface UserProfile {
  id: string;
  username: string;
  avatarData?: AvatarData;
}

export class AvatarController {
  public rootMesh: BABYLON.AbstractMesh | null = null;
  public roomId: string = 'main';

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
  private targetPosition: BABYLON.Vector3 | null = null;
  private isMoving = false;
  private renderObserver: (() => void) | null = null;

  constructor(scene: BABYLON.Scene, user: UserProfile) {
    this.scene = scene;
    this.user = user;
  }

  public get position(): BABYLON.Vector3 {
    return this.rootMesh?.position ?? BABYLON.Vector3.Zero();
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  async init(spawnPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero()): Promise<void> {
    await this.load(spawnPosition);
  }

  async load(spawnPosition: BABYLON.Vector3): Promise<void> {
    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        '',
        AVATAR_GLB_PATH,
        AVATAR_GLB_FILE,
        this.scene
      );

      if (!result.meshes.length) {
        throw new Error('[AvatarController] GLB loaded but contained no meshes.');
      }

      this.rootMesh = result.meshes[0];
      this.rootMesh.name = `avatar_local_${this.user.id}`;
      this.rootMesh.position = spawnPosition.clone();

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
      console.log(
        `[AvatarController] GLB loaded. Meshes: ${result.meshes.length}, MorphManagers: ${this.morphManagers.length}, AnimGroups: ${result.animationGroups.length}`
      );
    } catch (err) {
      console.warn('[AvatarController] GLB load failed, using procedural placeholder capsule:', err);
      this.buildPlaceholder(spawnPosition);
    }

    if (this.user.avatarData) {
      this.applyCustomization(this.user.avatarData);
    }

    this.attachNameTag();
    this.registerUpdateLoop();
  }

  private buildPlaceholder(spawnPosition: BABYLON.Vector3): void {
    const root = new BABYLON.TransformNode(`avatar_local_${this.user.id}`, this.scene);
    root.position = spawnPosition.clone();

    const body = BABYLON.MeshBuilder.CreateCapsule(
      'avatar_body',
      { radius: 0.25, height: 1.7, tessellation: 8 },
      this.scene
    );
    body.parent = root;
    body.position.y = 0.85;

    const head = BABYLON.MeshBuilder.CreateSphere(
      'avatar_head',
      { diameter: 0.4, segments: 8 },
      this.scene
    );
    head.parent = root;
    head.position.y = 1.95;

    const mat = new BABYLON.StandardMaterial('avatar_mat', this.scene);
    const skinHex = (this.user.avatarData?.skinTone as string) || '#F5CBA7';
    mat.diffuseColor = BABYLON.Color3.FromHexString(skinHex);
    body.material = mat;
    head.material = mat;

    this.rootMesh = body;
  }

  moveTo(target: BABYLON.Vector3): void {
    this.targetPosition = new BABYLON.Vector3(target.x, this.rootMesh?.position.y ?? 0, target.z);
    if (!this.isMoving) {
      this.isMoving = true;
      this.crossFadeTo('walk');
    }
  }

  playSocialAnim(name: 'sit' | 'wave' | 'dance'): void {
    this.targetPosition = null;
    this.isMoving = false;
    this.crossFadeTo(name, name !== 'wave'); // wave does not loop
  }

  applyCustomization(data: AvatarData): void {
    this.applyMorphTargets(data);
    this.applyMaterialColors(data);
  }

  // ─── Morph Targets ────────────────────────────────────────────────────────
  private applyMorphTargets(data: AvatarData): void {
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
  private applyMaterialColors(data: AvatarData): void {
    const colorMap: Record<string, string | undefined> = {
      mat_skin: data.skinTone || (data.skinColor as string),
      mat_hair: data.hairColor,
      mat_eyes: data.eyeColor,
      mat_shirt: data.topColor,
      mat_pants: data.bottomColor,
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

  private crossFadeTo(name: string, loop = true): void {
    const incoming = this.animations.get(name);
    if (!incoming) {
      return;
    }

    const outgoing = this.currentAnim;
    this.currentAnim = incoming;

    if (this.blendTimer !== null) {
      window.clearInterval(this.blendTimer);
    }

    let frame = 0;
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

  // ─── Movement Update Loop ─────────────────────────────────────────────────
  private registerUpdateLoop(): void {
    const callback = () => {
      if (!this.rootMesh || !this.targetPosition || !this.isMoving) return;

      const current = this.rootMesh.position;
      const dir = this.targetPosition.subtract(current);
      dir.y = 0;
      const dist = dir.length();
      const delta = this.scene.getEngine().getDeltaTime() / 1000;

      if (dist < ARRIVAL_THRESHOLD) {
        this.rootMesh.position.copyFrom(this.targetPosition);
        this.isMoving = false;
        this.targetPosition = null;
        this.crossFadeTo('idle');

        // Confirm final position to server
        const roomId =
          (window as unknown as Record<string, string>).__havenRoomId || this.roomId;
        socketService.emit('player:move', {
          roomId,
          x: this.rootMesh.position.x,
          y: this.rootMesh.position.y,
          z: this.rootMesh.position.z,
          rotY: this.rootMesh.rotation.y,
        });
        return;
      }

      // Rotate toward target
      const angle = Math.atan2(dir.x, dir.z);
      this.rootMesh.rotation.y = angle;

      // Move toward target
      const step = dir.normalize().scale(WALK_SPEED * delta);
      this.rootMesh.position.addInPlace(step);
    };

    this.scene.registerBeforeRender(callback);
    this.renderObserver = callback;
  }

  dispose(): void {
    if (this.blendTimer !== null) {
      window.clearInterval(this.blendTimer);
    }
    if (this.renderObserver) {
      this.scene.unregisterBeforeRender(this.renderObserver);
    }
    this.nameTagTexture?.dispose();
    this.nameTagMesh?.dispose();
    this.animations.forEach((ag) => ag.dispose());
    this.animations.clear();
    this.rootMesh?.dispose();
  }
}
