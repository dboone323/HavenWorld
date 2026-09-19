import {
  Scene,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  AbstractMesh,
} from '@babylonjs/core';
import { AdvancedDynamicTexture, TextBlock } from '@babylonjs/gui';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS, type PetType } from '@havenworld/shared';

export interface PetData {
  id: string;
  name: string;
  petType: PetType;
  happiness: number;
  hunger: number;
}

export class PetController {
  private _scene: Scene;
  private _petData: PetData;
  private _rootMesh: TransformNode;
  private _billboardLabel: TextBlock | null = null;
  private _targetMesh: TransformNode | null = null;
  private _renderObserver: (() => void) | null = null;
  private _unsubStateUpdate: (() => void) | null = null;

  constructor(scene: Scene, petData: PetData, followTarget?: TransformNode) {
    this._scene = scene;
    this._petData = petData;
    this._targetMesh = followTarget || null;

    this._rootMesh = new TransformNode(`pet_${petData.id}`, this._scene);
    if (followTarget) {
      this._rootMesh.position = followTarget.position.clone().add(new Vector3(1, 0, 1));
    }

    this._buildPetMesh();
    this._buildBillboard();
    this._startFollowLoop();
    this._listenToSocket();
  }

  private _buildPetMesh(): void {
    const colorMap: Record<string, Color3> = {
      CAT: Color3.FromHexString('#f97316'), // Orange tabby
      DOG: Color3.FromHexString('#a16207'), // Brown
      BABY_DRAGON: Color3.FromHexString('#10b981'), // Green emerald
    };

    const bodyColor = colorMap[this._petData.petType] || Color3.FromHexString('#3b82f6');
    const mat = new StandardMaterial(`pet_mat_${this._petData.id}`, this._scene);
    mat.diffuseColor = bodyColor;

    // Body capsule
    const body = MeshBuilder.CreateSphere(
      `pet_body_${this._petData.id}`,
      { diameterX: 0.5, diameterY: 0.4, diameterZ: 0.6 },
      this._scene
    );
    body.material = mat;
    body.parent = this._rootMesh;
    body.position.y = 0.2;

    // Head
    const head = MeshBuilder.CreateSphere(
      `pet_head_${this._petData.id}`,
      { diameter: 0.35 },
      this._scene
    );
    head.material = mat;
    head.parent = this._rootMesh;
    head.position.set(0, 0.4, 0.25);
  }

  private _buildBillboard(): void {
    const plane = MeshBuilder.CreatePlane(
      `pet_billboard_${this._petData.id}`,
      { width: 1.8, height: 0.45 },
      this._scene
    );
    plane.parent = this._rootMesh;
    plane.position.y = 0.85;
    plane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;

    const texture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 128);
    const label = new TextBlock(`pet_label_${this._petData.id}`, this._getDisplayText());
    label.color = '#ffffff';
    label.fontSize = 36;
    label.fontFamily = 'Calibri, sans-serif';
    texture.addControl(label);
    this._billboardLabel = label;
  }

  private _getDisplayText(): string {
    const emoji = this._petData.happiness > 70 ? '😊' : this._petData.happiness > 30 ? '😐' : '😢';
    return `${this._petData.name} ${emoji}`;
  }

  private _startFollowLoop(): void {
    this._renderObserver = () => {
      if (!this._targetMesh) return;

      const targetPos = this._targetMesh.position;
      const petPos = this._rootMesh.position;
      const distance = Vector3.Distance(petPos, targetPos);

      // Simple lerp follow when distance is larger than 1.5 units
      if (distance > 1.5) {
        const direction = targetPos.subtract(petPos).normalize();
        this._rootMesh.position.addInPlace(direction.scale(0.04));

        // Look at target in Y plane
        this._rootMesh.lookAt(new Vector3(targetPos.x, petPos.y, targetPos.z));
      }
    };
    this._scene.registerBeforeRender(this._renderObserver);
  }

  private _listenToSocket(): void {
    this._unsubStateUpdate = socketService.on<{
      petId: string;
      position?: { x: number; y: number; z: number };
      state?: string;
    }>(SOCKET_EVENTS.PET_STATE_UPDATE, (data) => {
      if (data.petId === this._petData.id && data.position) {
        // Optional remote sync if needed
      }
    });
  }

  updateStats(happiness: number, hunger: number): void {
    this._petData.happiness = happiness;
    this._petData.hunger = hunger;
    if (this._billboardLabel) {
      this._billboardLabel.text = this._getDisplayText();
    }
  }

  dispose(): void {
    if (this._renderObserver) {
      this._scene.unregisterBeforeRender(this._renderObserver);
      this._renderObserver = null;
    }
    if (this._unsubStateUpdate) {
      this._unsubStateUpdate();
      this._unsubStateUpdate = null;
    }
    this._rootMesh.dispose(false, true);
  }
}
