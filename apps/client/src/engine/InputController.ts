import {
  Scene,
  PointerEventTypes,
  PointerInfo,
  Observer,
  PickingInfo,
  Matrix,
  Camera,
  Tags,
} from '@babylonjs/core';
import { AvatarController } from '../world/AvatarController';

export class InputController {
  private _scene: Scene;
  private _avatar: AvatarController;
  private _camera: Camera;
  private _pointerObserver: Observer<PointerInfo> | null = null;
  private _enabled = true;

  constructor(scene: Scene, avatar: AvatarController, camera: Camera) {
    this._scene = scene;
    this._avatar = avatar;
    this._camera = camera;
    this._initPointer();
  }

  private _initPointer(): void {
    this._pointerObserver = this._scene.onPointerObservable.add((pointerInfo) => {
      if (!this._enabled) return;

      // Never move avatar while in Room Decorator / Edit mode
      const editor = (window as unknown as Record<string, unknown>).__havenRoomEditor as
        | { inEditMode?: boolean }
        | undefined;
      if (editor?.inEditMode) return;

      // React to pointer up or tap release
      if (pointerInfo.type === PointerEventTypes.POINTERUP || pointerInfo.type === PointerEventTypes.POINTERTAP) {
        const evt = pointerInfo.event as PointerEvent;
        // Only trigger on primary button (left click) or touch
        if (evt.button !== undefined && evt.button !== 0) return;

        let pick = pointerInfo.pickInfo;
        if (!pick || !pick.hit || !pick.pickedPoint || !pick.pickedMesh) {
          pick = this._scene.pick(this._scene.pointerX, this._scene.pointerY);
        }
        if (!pick || !pick.hit || !pick.pickedPoint || !pick.pickedMesh) return;

        // Always turn to face the clicked direction immediately
        this._avatar.lookAt(pick.pickedPoint);

        const mesh = pick.pickedMesh;
        if (mesh.metadata?.isRemoteAvatar || mesh.metadata?.isLocalAvatar) {
          // Handled by context menu
          return;
        }

        // Check if clicking placed furniture or seat mesh
        const furnitureManager = (typeof window !== 'undefined' && (window as any).__havenFurnitureManager) || null;
        const placed = furnitureManager?.pickFurniture(pick);
        const itemId = (placed?.itemId || '').toLowerCase();
        const meshName = (mesh.name || '').toLowerCase();

        const isSeat =
          itemId.includes('chair') ||
          itemId.includes('sofa') ||
          itemId.includes('couch') ||
          itemId.includes('bench') ||
          itemId.includes('stool') ||
          itemId.includes('bed') ||
          meshName.includes('chair') ||
          meshName.includes('sofa') ||
          meshName.includes('bench') ||
          meshName.includes('stool') ||
          meshName.includes('bed') ||
          mesh.metadata?.interactable === 'sit';

        if (isSeat) {
          const seatTarget = placed?.mesh || mesh;
          const seatPos = seatTarget.getAbsolutePosition();
          this._avatar.moveTo(seatPos, () => {
            this._avatar.sitOn(seatTarget);
          });
          return;
        }

        const isWalkable =
          mesh.metadata?.walkable === true ||
          Tags.MatchesQuery(mesh, 'walkable') ||
          mesh.name.startsWith('Walkable_') ||
          mesh.name.startsWith('NavMesh_') ||
          mesh.name === 'Floor' ||
          mesh.name === 'placeholder_ground' ||
          mesh.name.includes('rug');

        if (isWalkable) {
          this._avatar.moveTo(pick.pickedPoint);
        }
      }
    });
  }

  /**
   * Programmatic raycast from screen pixel coordinates into the 3D scene.
   */
  public castRayFromScreen(x: number, y: number): PickingInfo | null {
    const ray = this._scene.createPickingRay(x, y, Matrix.Identity(), this._camera);
    return this._scene.pickWithRay(ray);
  }

  public setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  public dispose(): void {
    if (this._pointerObserver) {
      this._scene.onPointerObservable.remove(this._pointerObserver);
      this._pointerObserver = null;
    }
  }
}
