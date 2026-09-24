import {
  Scene,
  TransformNode,
  AbstractMesh,
  Vector3,
  Color3,
  StandardMaterial,
  MeshBuilder,
  Scalar,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock, Rectangle } from '@babylonjs/gui';
import type { AvatarData } from '@havenworld/shared';
import type { UserProfile } from './AvatarController';

export class RemoteAvatar {
  public rootMesh: TransformNode;
  public userId: string;
  public username: string;

  private _scene: Scene;
  private _meshes: AbstractMesh[] = [];
  private _nameTagMesh: AbstractMesh | null = null;
  private _speechBubbleMesh: AbstractMesh | null = null;
  private _speechBubbleTexture: AdvancedDynamicTexture | null = null;
  private _speechText: TextBlock | null = null;
  private _speechContainer: Rectangle | null = null;
  private _speechTimeout: number | null = null;

  private _targetPos: Vector3;
  private _targetRotY: number = 0;
  private _renderObserver: (() => void) | null = null;

  constructor(scene: Scene, user: UserProfile, initialPos?: { x: number; y: number; z: number; rotY?: number }) {
    this._scene = scene;
    this.userId = user.id;
    this.username = user.username;

    this.rootMesh = new TransformNode(`remoteAvatar_${user.id}`, this._scene);
    const startX = initialPos?.x ?? 0;
    const startY = initialPos?.y ?? 0;
    const startZ = initialPos?.z ?? 0;
    this._targetRotY = initialPos?.rotY ?? 0;

    this.rootMesh.position.set(startX, startY, startZ);
    this.rootMesh.rotation.y = this._targetRotY;
    this._targetPos = new Vector3(startX, startY, startZ);

    this._buildPlaceholder(user.avatarData);
    this._buildNameTag();
    this._buildSpeechBubble();
    this._registerRenderLoop();
  }

  private _buildPlaceholder(avatarData?: AvatarData): void {
    const body = MeshBuilder.CreateCapsule(
      `remote_body_${this.userId}`,
      { radius: 0.25, height: 1.7, tessellation: 8 },
      this._scene
    );
    body.parent = this.rootMesh;
    body.position.y = 0.85;

    const head = MeshBuilder.CreateSphere(
      `remote_head_${this.userId}`,
      { diameter: 0.4, segments: 8 },
      this._scene
    );
    head.parent = this.rootMesh;
    head.position.y = 1.95;

    const mat = new StandardMaterial(`remote_mat_${this.userId}`, this._scene);
    // Canonical field is skinTone (the server sends it from the Avatar DB row);
    // skinColor is only a legacy fallback for older payloads.
    const skinHex = avatarData?.skinTone || avatarData?.skinColor;
    if (skinHex) {
      mat.diffuseColor = Color3.FromHexString(skinHex);
    } else {
      // Deterministic pastel color per user
      const hue = this._getHueFromId(this.userId);
      mat.diffuseColor = Color3.FromHSV(hue, 0.65, 0.85);
    }

    body.material = mat;
    head.material = mat;
    body.metadata = { isRemoteAvatar: true, userId: this.userId, username: this.username };
    head.metadata = { isRemoteAvatar: true, userId: this.userId, username: this.username };
    this._meshes = [body, head];
  }

  private _getHueFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 360);
  }

  private _buildNameTag(): void {
    const plane = MeshBuilder.CreatePlane(
      `remote_nametag_${this.userId}`,
      { width: 2.2, height: 0.45 },
      this._scene
    );
    plane.parent = this.rootMesh;
    plane.position.y = 2.4;
    plane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;

    const texture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 128);
    const label = new TextBlock(`remote_name_text_${this.userId}`, this.username);
    label.color = '#e2e8f0';
    label.fontSize = 44;
    label.fontFamily = 'Calibri, sans-serif';
    texture.addControl(label);

    this._nameTagMesh = plane;
  }

  private _buildSpeechBubble(): void {
    const plane = MeshBuilder.CreatePlane(
      `remote_speech_${this.userId}`,
      { width: 3.0, height: 1.2 },
      this._scene
    );
    plane.parent = this.rootMesh;
    plane.position.y = 3.1;
    plane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
    plane.isVisible = false;

    const texture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 256);
    this._speechBubbleTexture = texture;

    const rect = new Rectangle(`speech_rect_${this.userId}`);
    rect.width = 0.95;
    rect.height = 0.85;
    rect.cornerRadius = 20;
    rect.color = '#4ecdc4';
    rect.thickness = 2;
    rect.background = 'rgba(26, 26, 46, 0.9)';
    texture.addControl(rect);
    this._speechContainer = rect;

    const text = new TextBlock(`speech_text_${this.userId}`);
    text.color = '#ffffff';
    text.fontSize = 32;
    text.fontFamily = 'Calibri, sans-serif';
    text.textWrapping = true;
    text.paddingLeft = '16px';
    text.paddingRight = '16px';
    text.paddingTop = '10px';
    text.paddingBottom = '10px';
    rect.addControl(text);
    this._speechText = text;

    this._speechBubbleMesh = plane;
  }

  private _registerRenderLoop(): void {
    const callback = () => {
      // Smooth position lerp
      this.rootMesh.position = Vector3.Lerp(this.rootMesh.position, this._targetPos, 0.2);
      // Smooth rotation lerp
      this.rootMesh.rotation.y = Scalar.LerpAngle(this.rootMesh.rotation.y, this._targetRotY, 0.2);
    };

    this._scene.registerBeforeRender(callback);
    this._renderObserver = callback;
  }

  public updatePosition(x: number, y: number, z: number, rotY?: number): void {
    this._targetPos.set(x, y, z);
    if (rotY !== undefined) {
      this._targetRotY = rotY;
    }
  }

  public showSpeech(message: string): void {
    if (!this._speechBubbleMesh || !this._speechText) return;

    this._speechText.text = message;
    this._speechBubbleMesh.isVisible = true;

    if (this._speechTimeout) {
      window.clearTimeout(this._speechTimeout);
    }

    this._speechTimeout = window.setTimeout(() => {
      if (this._speechBubbleMesh) {
        this._speechBubbleMesh.isVisible = false;
      }
      this._speechTimeout = null;
    }, 4000);
  }

  public applyCustomization(data: AvatarData): void {
    const skinHex = data.skinTone || data.skinColor;
    if (skinHex && this._meshes.length > 0) {
      const mat = this._meshes[0].material as StandardMaterial;
      if (mat) {
        mat.diffuseColor = Color3.FromHexString(skinHex);
      }
    }
  }

  public dispose(): void {
    if (this._speechTimeout) {
      window.clearTimeout(this._speechTimeout);
    }
    if (this._renderObserver) {
      this._scene.unregisterBeforeRender(this._renderObserver);
    }
    this._meshes.forEach((m) => m.dispose());
    this._nameTagMesh?.dispose();
    this._speechBubbleMesh?.dispose();
    this._speechBubbleTexture?.dispose();
    this.rootMesh.dispose();
  }
}
