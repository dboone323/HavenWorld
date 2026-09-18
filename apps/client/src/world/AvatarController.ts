import {
  Scene,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  Vector3,
  Color3,
  StandardMaterial,
  MeshBuilder,
  SceneLoader,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock } from '@babylonjs/gui';
import { socketService } from '../services/socket';

export interface AvatarData {
  skinColor?: string;
  hairColor?: string;
  eyeColor?: string;
  bodyMorphs?: Record<string, number>;
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  username: string;
  avatarData?: AvatarData;
}

export class AvatarController {
  public rootMesh!: TransformNode;
  private _scene: Scene;
  private _user: UserProfile;
  private _meshes: AbstractMesh[] = [];
  private _animations: Map<string, AnimationGroup> = new Map();
  private _currentAnim: AnimationGroup | null = null;
  private _targetPosition: Vector3 | null = null;
  private _isMoving = false;
  private _moveSpeed = 3.5; // meters per second
  private _nameTagMesh: AbstractMesh | null = null;
  public roomId: string = 'main';

  constructor(scene: Scene, user: UserProfile) {
    this._scene = scene;
    this._user = user;
  }

  public async init(): Promise<void> {
    try {
      await this._loadGLB();
    } catch {
      console.warn('[AvatarController] GLB not found — using placeholder capsule.');
      this._buildPlaceholder();
    }

    this._buildNameTag();
    this._registerRenderLoop();
  }

  private async _loadGLB(): Promise<void> {
    const result = await SceneLoader.ImportMeshAsync(
      '',
      '',
      '/assets/avatars/base_avatar.glb',
      this._scene
    );

    this.rootMesh = new TransformNode('localAvatar_root', this._scene);
    result.meshes[0].parent = this.rootMesh;
    this._meshes = result.meshes as AbstractMesh[];

    // Apply avatar customization
    if (this._user.avatarData) {
      this._applyMaterials(this._user.avatarData);
    }

    // Register animation groups by name
    for (const ag of result.animationGroups) {
      this._animations.set(ag.name, ag);
      ag.stop();
    }

    this._playAnimation('idle', true);
  }

  private _buildPlaceholder(): void {
    this.rootMesh = new TransformNode('localAvatar_root', this._scene);

    const body = MeshBuilder.CreateCapsule(
      'avatar_body',
      { radius: 0.25, height: 1.7, tessellation: 8 },
      this._scene
    );
    body.parent = this.rootMesh;
    body.position.y = 0.85;

    const head = MeshBuilder.CreateSphere(
      'avatar_head',
      { diameter: 0.4, segments: 8 },
      this._scene
    );
    head.parent = this.rootMesh;
    head.position.y = 1.95;

    const mat = new StandardMaterial('avatar_mat', this._scene);
    const skinHex = this._user.avatarData?.skinColor || '#F5CBA7';
    mat.diffuseColor = Color3.FromHexString(skinHex);
    body.material = mat;
    head.material = mat;

    this._meshes = [body, head];
  }

  private _applyMaterials(data: AvatarData): void {
    if (data.bodyMorphs) {
      for (const [name, value] of Object.entries(data.bodyMorphs)) {
        for (const mesh of this._meshes) {
          const manager = (
            mesh as unknown as {
              morphTargetManager?: {
                numTargets: number;
                getTarget: (i: number) => { name: string; influence: number };
              };
            }
          ).morphTargetManager;
          if (!manager) continue;
          for (let i = 0; i < manager.numTargets; i++) {
            const target = manager.getTarget(i);
            if (target.name === name) {
              target.influence = value;
            }
          }
        }
      }
    }
  }

  private _buildNameTag(): void {
    const plane = MeshBuilder.CreatePlane(
      'nametag_plane',
      { width: 2, height: 0.4 },
      this._scene
    );
    plane.parent = this.rootMesh;
    plane.position.y = 2.4;
    plane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;

    const texture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 128);
    const label = new TextBlock('nametag_text', this._user.username);
    label.color = '#ffffff';
    label.fontSize = 48;
    label.fontFamily = 'Calibri, sans-serif';
    texture.addControl(label);

    this._nameTagMesh = plane;
  }

  private _playAnimation(name: string, loop: boolean): void {
    if (this._currentAnim) this._currentAnim.stop();
    const anim = this._animations.get(name);
    if (anim) {
      anim.start(loop, 1.0, anim.from, anim.to, false);
      this._currentAnim = anim;
    }
  }

  private _registerRenderLoop(): void {
    this._scene.registerBeforeRender(() => {
      if (!this._targetPosition || !this._isMoving) return;

      const current = this.rootMesh.position;
      const dir = this._targetPosition.subtract(current);
      dir.y = 0; // Ignore vertical height
      const dist = dir.length();
      const dt = this._scene.getEngine().getDeltaTime() / 1000;

      if (dist < 0.05) {
        this.rootMesh.position.copyFrom(this._targetPosition);
        this._isMoving = false;
        this._playAnimation('idle', true);

        // Confirm final position to server
        const roomId =
          (window as unknown as Record<string, string>).__havenRoomId || this.roomId;
        socketService.emit('player:move', {
          roomId,
          x: this._targetPosition.x,
          y: this._targetPosition.y,
          z: this._targetPosition.z,
          rotY: this.rootMesh.rotation.y,
        });
        return;
      }

      const step = dir.normalize().scale(this._moveSpeed * dt);
      this.rootMesh.position.addInPlace(step);

      // Rotate to face movement direction
      const angle = Math.atan2(dir.x, dir.z);
      this.rootMesh.rotation.y = angle;
    });
  }

  /** Move avatar to a target world position. */
  public moveTo(target: Vector3): void {
    this._targetPosition = target.clone();
    this._targetPosition.y = 0; // Always walk on ground plane
    this._isMoving = true;
    this._playAnimation('walk', true);
  }

  public applyAvatarData(data: AvatarData): void {
    this._applyMaterials(data);
  }

  public dispose(): void {
    this._meshes.forEach((m) => m.dispose());
    this._nameTagMesh?.dispose();
    this.rootMesh.dispose();
  }
}
