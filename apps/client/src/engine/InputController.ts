import {
  Scene,
  PointerEventTypes,
  PointerInfo,
  Observer,
  PickingInfo,
  Matrix,
  Camera,
  Tags,
  HighlightLayer,
  Color3,
  Mesh,
} from '@babylonjs/core';
import { AvatarController } from '../world/AvatarController';
import { showToast } from '../ui/ToastNotification';
import { audioEngine } from '../audio/AudioEngine';

function formatFurnitureTitle(itemId: string): string {
  if (!itemId) return 'Furniture Item';
  return itemId
    .replace(/^furn_/i, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function getFurnitureIcon(itemId: string): string {
  const id = (itemId || '').toLowerCase();
  if (id.includes('chair') || id.includes('sofa') || id.includes('couch') || id.includes('bench') || id.includes('stool')) return '🪑';
  if (id.includes('bed')) return '🛏️';
  if (id.includes('lamp') || id.includes('light')) return '💡';
  if (id.includes('table') || id.includes('desk')) return '🪵';
  if (id.includes('plant') || id.includes('pot') || id.includes('flower') || id.includes('cactus')) return '🪴';
  if (id.includes('tv') || id.includes('television') || id.includes('screen') || id.includes('arcade') || id.includes('computer')) return '📺';
  if (id.includes('shelf') || id.includes('bookcase') || id.includes('bookshelf')) return '📚';
  if (id.includes('rug') || id.includes('carpet')) return '🧶';
  return '📦';
}

function getFurnitureCategory(itemId: string): string {
  const id = (itemId || '').toLowerCase();
  if (id.includes('chair') || id.includes('sofa') || id.includes('couch') || id.includes('stool') || id.includes('bed')) return 'Seating';
  if (id.includes('lamp') || id.includes('light')) return 'Lighting';
  if (id.includes('table') || id.includes('desk')) return 'Surfaces';
  if (id.includes('plant') || id.includes('pot') || id.includes('flower')) return 'Flora';
  if (id.includes('shelf') || id.includes('bookcase')) return 'Storage';
  if (id.includes('rug') || id.includes('carpet')) return 'Decor';
  return 'Furniture';
}

export class InputController {
  private _scene: Scene;
  private _avatar: AvatarController;
  private _camera: Camera;
  private _pointerObserver: Observer<PointerInfo> | null = null;
  private _highlightLayer: HighlightLayer | null = null;
  private _hoveredMesh: Mesh | null = null;
  private _enabled = true;
  private _keysDown = new Set<string>();
  private _keyboardObserver: (() => void) | null = null;
  private _renderObserver: Observer<Scene> | null = null;
  private _lastKeyboardMoveTime = 0;

  constructor(scene: Scene, avatar: AvatarController, camera: Camera) {
    this._scene = scene;
    this._avatar = avatar;
    this._camera = camera;
    try {
      if (typeof window !== 'undefined' && this._scene.getEngine().getRenderingCanvas()) {
        this._highlightLayer = new HighlightLayer('furniture_hover_hl', this._scene, { isStroke: true });
      }
    } catch {
      // Graceful fallback for test/headless environments
    }
    this._initPointer();
    this._initKeyboard();
  }

  private _initPointer(): void {
    this._pointerObserver = this._scene.onPointerObservable.add((pointerInfo) => {
      if (!this._enabled) return;

      // Never move avatar while in Room Decorator / Edit mode
      const editor = (window as unknown as Record<string, unknown>).__havenRoomEditor as
        | { inEditMode?: boolean }
        | undefined;
      if (editor?.inEditMode) return;

      // Handle hover cursor and highlight
      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        let pick = pointerInfo.pickInfo;
        if (!pick || !pick.hit || !pick.pickedMesh) {
          pick = this._scene.pick(this._scene.pointerX, this._scene.pointerY);
        }
        const canvas = this._scene.getEngine().getRenderingCanvas();
        const furnitureManager = (typeof window !== 'undefined' && (window as any).__havenFurnitureManager) || null;
        const placed = pick && pick.hit ? furnitureManager?.pickFurniture(pick) : null;
        const isHoveringFurniture = Boolean(placed);

        if (canvas) {
          if (isHoveringFurniture || pick?.pickedMesh?.metadata?.isRemoteAvatar) {
            canvas.style.cursor = 'pointer';
          } else {
            canvas.style.cursor = 'default';
          }
        }

        if (this._highlightLayer) {
          const targetMesh = (placed?.mesh || null) as Mesh | null;
          if (targetMesh !== this._hoveredMesh) {
            if (this._hoveredMesh) {
              try {
                this._highlightLayer.removeMesh(this._hoveredMesh);
              } catch {
                // Ignore removal error
              }
            }
            this._hoveredMesh = targetMesh;
            if (targetMesh && targetMesh instanceof Mesh) {
              try {
                this._highlightLayer.addMesh(targetMesh, Color3.FromHexString('#4ecdc4'));
              } catch {
                // Ignore highlight error
              }
            }
          }
        }
        return;
      }

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

        if (placed) {
          audioEngine.playClick();

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
            const seatTarget = placed.mesh || mesh;
            const seatPos = seatTarget.getAbsolutePosition();
            this._avatar.moveTo(seatPos, () => {
              this._avatar.sitOn(seatTarget);
            });
            return;
          }

          const isLamp =
            itemId.includes('lamp') ||
            itemId.includes('light') ||
            meshName.includes('lamp') ||
            meshName.includes('light');

          if (isLamp) {
            const lampTarget = placed.mesh || mesh;
            const targetPos = lampTarget.getAbsolutePosition();
            this._avatar.moveTo(targetPos);
            const isLit = !lampTarget.metadata?.isLit;
            lampTarget.metadata = { ...(lampTarget.metadata || {}), isLit };
            if (lampTarget.material && 'emissiveColor' in lampTarget.material) {
              (lampTarget.material as any).emissiveColor = isLit
                ? Color3.FromHexString('#fffae0')
                : Color3.Black();
            }
            showToast({
              icon: isLit ? '💡' : '🌑',
              title: isLit ? 'Lamp Lit' : 'Lamp Off',
              subtitle: formatFurnitureTitle(placed.itemId),
            });
            return;
          }

          // Any other non-seat furniture (tables, plant, bookshelf, tv, laptop, rug)
          const targetPos = (placed.mesh || mesh).getAbsolutePosition();
          this._avatar.moveTo(targetPos);
          showToast({
            icon: getFurnitureIcon(placed.itemId),
            title: formatFurnitureTitle(placed.itemId),
            subtitle: `${getFurnitureCategory(placed.itemId)} • Loft Furniture`,
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

        if (isWalkable && pick.pickedPoint) {
          // Clamp walk target within the 14m physical room bounds (-6.4m to +6.4m)
          const target = pick.pickedPoint.clone();
          target.x = Math.max(-6.4, Math.min(6.4, target.x));
          target.z = Math.max(-6.4, Math.min(6.4, target.z));
          this._avatar.moveTo(target);
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

  private _initKeyboard(): void {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!this._enabled) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const code = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        this._keysDown.add(code);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      this._keysDown.delete(e.code);
    };

    const handleBlur = () => {
      this._keysDown.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    this._keyboardObserver = () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };

    this._renderObserver = this._scene.onBeforeRenderObservable.add(() => {
      if (!this._enabled || this._keysDown.size === 0) return;

      const editor = (window as unknown as Record<string, unknown>).__havenRoomEditor as
        | { inEditMode?: boolean }
        | undefined;
      if (editor?.inEditMode) return;

      const now = performance.now();
      if (now - this._lastKeyboardMoveTime < 180) return;

      let dx = 0;
      let dz = 0;

      if (this._keysDown.has('KeyW') || this._keysDown.has('ArrowUp')) dz += 1;
      if (this._keysDown.has('KeyS') || this._keysDown.has('ArrowDown')) dz -= 1;
      if (this._keysDown.has('KeyA') || this._keysDown.has('ArrowLeft')) dx -= 1;
      if (this._keysDown.has('KeyD') || this._keysDown.has('ArrowRight')) dx += 1;

      if (dx === 0 && dz === 0) return;

      const len = Math.hypot(dx, dz);
      dx = (dx / len) * 1.5;
      dz = (dz / len) * 1.5;

      const currentPos = this._avatar.position;
      const targetPos = currentPos.clone();
      targetPos.x = Math.max(-6.4, Math.min(6.4, currentPos.x + dx));
      targetPos.z = Math.max(-6.4, Math.min(6.4, currentPos.z + dz));

      this._avatar.moveTo(targetPos);
      this._lastKeyboardMoveTime = now;
    });
  }

  public dispose(): void {
    if (this._pointerObserver) {
      this._scene.onPointerObservable.remove(this._pointerObserver);
      this._pointerObserver = null;
    }
    if (this._renderObserver) {
      this._scene.onBeforeRenderObservable.remove(this._renderObserver);
      this._renderObserver = null;
    }
    if (this._keyboardObserver) {
      this._keyboardObserver();
      this._keyboardObserver = null;
    }
    this._keysDown.clear();
    if (this._hoveredMesh && this._highlightLayer) {
      try {
        this._highlightLayer.removeMesh(this._hoveredMesh);
      } catch {
        // Ignore
      }
      this._hoveredMesh = null;
    }
    this._highlightLayer?.dispose();
    this._highlightLayer = null;
  }
}
