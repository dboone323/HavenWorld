import * as BABYLON from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import { FurnitureManager, type PlacedFurniture } from './FurnitureManager';
import { SERVER_URL, assetUrl } from '../config';
import { authService } from '../services/auth';
import { showToast } from '../ui/ToastNotification';
import { applyRoomSurfaces } from './SurfaceManager';
import { audioEngine } from '../audio/AudioEngine';

export interface FurniturePlacement {
  id: string; // UUID (temp for new items, DB id for existing)
  itemId: string;
  assetUrl?: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  isNew?: boolean;
  isRemoved?: boolean;
}

export class RoomEditor {
  private scene: BABYLON.Scene;
  public furnitureManager: FurnitureManager;
  private roomId: string;
  private floorY = 0;
  private isEditing = false;

  private ghostMesh: BABYLON.AbstractMesh | null = null;
  private ghostItemId: string | null = null;
  private ghostAssetUrl: string | null = null;
  private gridMesh: BABYLON.Mesh | null = null;
  private selectedFurniture: PlacedFurniture | null = null;
  private pointerObserver: BABYLON.Observer<BABYLON.PointerInfo> | null = null;
  private contextMenu: HTMLElement | null = null;
  private selectedToolbar: HTMLElement | null = null;
  private editorHighlightLayer: BABYLON.HighlightLayer | null = null;

  private currentRotation = 0; // 0, 90, 180, 270 degrees
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;

  private isPlacing = false;
  private lastPointerActionTime = 0;

  // Grid & Snap Toggles
  public gridVisible = true;
  public snapEnabled = true;
  private activeEditorTab: 'furniture' | 'surfaces' = 'furniture';

  // Tracks changes in this edit session
  private pendingChanges: Map<string, FurniturePlacement> = new Map();
  private onModeChange?: (inEditMode: boolean) => void;

  constructor(
    scene: BABYLON.Scene,
    furnitureManager: FurnitureManager,
    roomId: string,
    floorY = 0,
    onModeChange?: (inEditMode: boolean) => void
  ) {
    this.scene = scene;
    this.furnitureManager = furnitureManager;
    this.roomId = roomId;
    this.floorY = floorY;
    this.onModeChange = onModeChange;
  }

  // ─── Enter / Exit Edit Mode ───────────────────────────────────────────────
  enterEditMode(): void {
    if (this.isEditing) return;
    this.isEditing = true;
    this.pendingChanges.clear();
    this.showGrid();
    this.attachPointerObserver();
    this.buildInventoryPanel();
    this.onModeChange?.(true);

    this.keydownListener = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'r' || e.key === 'R') {
        this.cycleRotation();
      }
    };
    window.addEventListener('keydown', this.keydownListener);

    console.log('[RoomEditor] Edit mode ON');
  }

  exitEditMode(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.hideGrid();
    this.clearGhostMesh();
    this.detachPointerObserver();
    this.removeInventoryPanel();
    this.removeContextMenu();
    this.removeSelectedToolbar();
    this.selectedFurniture = null;
    this.onModeChange?.(false);

    if (this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }

    console.log('[RoomEditor] Edit mode OFF');
  }

  get inEditMode(): boolean {
    return this.isEditing;
  }

  // ─── Grid Helper ──────────────────────────────────────────────────────────
  public showGrid(): void {
    if (this.gridMesh) return;
    this.gridMesh = BABYLON.MeshBuilder.CreateGround(
      'editor_grid',
      { width: 30, height: 30, subdivisions: 60 },
      this.scene
    );
    this.gridMesh.position.y = this.floorY + 0.002; // slightly above floor
    this.gridMesh.isPickable = true;
    this.gridMesh.metadata = { walkable: true, isEditorGrid: true };

    const gridMat = new GridMaterial('editor_grid_mat', this.scene);
    gridMat.majorUnitFrequency = 5;
    gridMat.minorUnitVisibility = 0.45;
    gridMat.gridRatio = 0.5; // 0.5m grid lines
    gridMat.backFaceCulling = false;
    gridMat.mainColor = new BABYLON.Color3(0.2, 0.6, 1.0);
    gridMat.lineColor = new BABYLON.Color3(0.4, 0.7, 1.0);
    gridMat.opacity = 0.5;

    this.gridMesh.material = gridMat;
  }

  public hideGrid(): void {
    this.gridMesh?.dispose();
    this.gridMesh = null;
  }

  public setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    if (this.isEditing) {
      if (this.gridVisible) {
        this.showGrid();
      } else {
        this.hideGrid();
      }
    }
  }

  public setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled;
  }

  public getGridMesh(): BABYLON.Mesh | null {
    return this.gridMesh;
  }

  public hasPendingChanges(): boolean {
    return this.pendingChanges.size > 0;
  }

  public addPendingPlacement(placement: FurniturePlacement): void {
    this.pendingChanges.set(placement.id, placement);
  }

  // ─── Ghost Mesh (Placement Preview) ───────────────────────────────────────
  async startPlacement(itemId: string, assetUrlProp?: string): Promise<void> {
    this.clearGhostMesh();
    this.ghostItemId = itemId;
    this.ghostAssetUrl = assetUrlProp || `/assets/furniture/${itemId}.glb`;

    // 1. Immediately spawn procedural ghost preview so placement starts with 0 latency
    const dims = FurnitureManager.getProceduralDimensions(itemId);
    const ghostBox = BABYLON.MeshBuilder.CreateBox('ghost_placement', dims, this.scene);
    const ghostMat = new BABYLON.StandardMaterial('ghost_mat_preview', this.scene);
    ghostMat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 1.0);
    ghostMat.alpha = 0.55;
    ghostMat.backFaceCulling = false;
    ghostBox.material = ghostMat;
    ghostBox.isPickable = false;
    ghostBox.rotation.y = (this.currentRotation * Math.PI) / 180;
    this.ghostMesh = ghostBox;

    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (pick?.hit && pick.pickedPoint) {
      this.ghostMesh.position = this.snapToGrid(pick.pickedPoint);
    } else {
      this.ghostMesh.position = new BABYLON.Vector3(0, this.floorY + 0.4, 0);
    }

    // 2. Asynchronously load the 3D GLB model and replace procedural ghost once ready
    const fullAssetUrl = this.ghostAssetUrl.startsWith('/')
      ? assetUrl(this.ghostAssetUrl)
      : assetUrl(`/assets/furniture/${itemId}.glb`);
    const pathParts = fullAssetUrl.split('/');
    const fileName = pathParts.pop()!;
    const folder = pathParts.join('/') + '/';

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', folder, fileName, this.scene);
      // Only apply if user is still placing this exact item
      if (this.ghostItemId === itemId && this.ghostMesh) {
        const lastPos = this.ghostMesh.position.clone();
        const lastRot = this.ghostMesh.rotation.y;
        this.clearGhostMesh();

        this.ghostMesh = result.meshes[0];
        this.ghostMesh.name = 'ghost_placement';
        this.ghostMesh.isPickable = false;
        this.ghostMesh.position = lastPos;
        this.ghostMesh.rotation.y = lastRot;

        result.meshes.forEach((mesh) => {
          const mat = new BABYLON.StandardMaterial(`ghost_mat_${mesh.name}`, this.scene);
          mat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 1.0);
          mat.alpha = 0.55;
          mat.backFaceCulling = false;
          mesh.material = mat;
          mesh.isPickable = false;
        });
      } else {
        result.meshes.forEach((m) => m.dispose());
      }
    } catch {
      // Retain the procedural bounding box preview if GLB is missing or slow
    }
  }

  public cycleRotation(): void {
    this.currentRotation = (this.currentRotation + 90) % 360;
    const rad = (this.currentRotation * Math.PI) / 180;
    if (this.ghostMesh) {
      this.ghostMesh.rotation.y = rad;
    }
    if (this.selectedFurniture) {
      this.rotateFurniture(this.selectedFurniture.id, Math.PI / 2);
    }
    this.updateRotationLabel();
  }

  private updateRotationLabel(): void {
    const label = document.getElementById('editor-rot-label');
    if (label) {
      const dirNames: Record<number, string> = {
        0: '0° (South)',
        90: '90° (West)',
        180: '180° (North)',
        270: '270° (East)',
      };
      label.textContent = dirNames[this.currentRotation] || `${this.currentRotation}°`;
    }
  }

  private clearGhostMesh(): void {
    this.ghostMesh?.dispose();
    this.ghostMesh = null;
    this.ghostItemId = null;
    this.ghostAssetUrl = null;
  }

  // ─── Pointer Handling ─────────────────────────────────────────────────────
  private attachPointerObserver(): void {
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERMOVE:
          this.onPointerMove();
          break;
        case BABYLON.PointerEventTypes.POINTERDOWN:
        case BABYLON.PointerEventTypes.POINTERTAP: {
          const evt = pointerInfo.event as PointerEvent;
          const isPrimary = evt.button === 0 || evt.button === undefined;
          const isRight = evt.button === 2;
          const now = Date.now();
          if (now - this.lastPointerActionTime < 120) return;
          this.lastPointerActionTime = now;

          if (isPrimary) this.onPointerDown();
          if (isRight) this.onRightClick(evt);
          break;
        }
      }
    });
  }

  private detachPointerObserver(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
  }

  private onPointerMove(): void {
    if (!this.ghostMesh) return;
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) =>
        mesh !== this.ghostMesh &&
        !mesh.name.startsWith('ghost_') &&
        (mesh.metadata?.walkable ||
          mesh.name.startsWith('walkable') ||
          mesh.name === 'placeholder_ground' ||
          mesh.name === 'editor_grid' ||
          mesh.name === 'Floor' ||
          mesh.name.includes('table') ||
          mesh.name.includes('rug') ||
          mesh.name.includes('console') ||
          mesh.name.includes('shelf') ||
          mesh.name.includes('stand') ||
          this.furnitureManager.pickFurniture({ hit: true, pickedMesh: mesh } as unknown as BABYLON.PickingInfo) !== null)
    );
    if (pick?.hit && pick.pickedPoint) {
      const snapped = this.snapToGrid(pick.pickedPoint);
      // Stacking elevation: calculate surface top if hovering over furniture/table/rug
      if (
        pick.pickedMesh &&
        pick.pickedMesh.name !== 'Floor' &&
        pick.pickedMesh.name !== 'editor_grid' &&
        !pick.pickedMesh.name.includes('rug')
      ) {
        const bounds = pick.pickedMesh.getBoundingInfo().boundingBox;
        const topY = bounds.maximumWorld.y;
        if (this.ghostMesh) {
          const ghostBb = this.ghostMesh.getBoundingInfo().boundingBox;
          snapped.y = topY + ghostBb.extendSize.y;
        } else {
          snapped.y = topY;
        }
      }
      this.ghostMesh.position = snapped;
    }
  }

  private onPointerDown(): void {
    this.removeContextMenu();
    if (this.ghostMesh && this.ghostItemId && this.ghostAssetUrl) {
      this.onPointerMove();
      this.placeFurnitureFromGhost();
      return;
    }

    // Check if clicking existing furniture mesh
    const furniturePick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => {
        for (const [, pf] of this.furnitureManager.allPlaced) {
          if (
            pf.mesh === mesh ||
            mesh.isDescendantOf(pf.mesh) ||
            mesh.name.includes(pf.id) ||
            mesh.name.includes(pf.itemId)
          ) {
            return true;
          }
        }
        return false;
      }
    );

    if (furniturePick?.hit && furniturePick.pickedMesh) {
      const hit = this.furnitureManager.pickFurniture(furniturePick);
      if (hit) {
        this.showSelectedToolbar(hit);
        return;
      }
    }

    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (pick?.hit) {
      const hit = this.furnitureManager.pickFurniture(pick);
      this.selectedFurniture = hit ?? null;
      if (hit) {
        this.showSelectedToolbar(hit);
      } else {
        this.removeSelectedToolbar();
      }
    } else {
      this.removeSelectedToolbar();
    }
  }

  private onRightClick(evt: PointerEvent): void {
    evt.preventDefault();
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (pick) {
      const hit = this.furnitureManager.pickFurniture(pick);
      if (hit) {
        this.selectedFurniture = hit;
        this.showContextMenu(hit, evt);
      }
    }
  }

  // ─── Furniture Placement ──────────────────────────────────────────────────
  private async placeFurnitureFromGhost(): Promise<void> {
    if (this.isPlacing || !this.ghostMesh || !this.ghostItemId || !this.ghostAssetUrl) return;
    this.isPlacing = true;
    try {
      const pos = this.ghostMesh.position.clone();
      const rotRad = this.ghostMesh.rotation.y;
      const uuidStr =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const tempId = `new_${uuidStr}`;

      const placement: FurniturePlacement = {
        id: tempId,
        itemId: this.ghostItemId,
        assetUrl: this.ghostAssetUrl,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        rotY: rotRad,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        isNew: true,
        isRemoved: false,
      };

      this.pendingChanges.set(tempId, placement);

      const placedItem = await this.furnitureManager.placeItem({
        id: tempId,
        itemId: placement.itemId,
        assetUrl: placement.assetUrl!,
        placedById: 'local',
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rotY: placement.rotY,
        scaleX: placement.scaleX,
        scaleY: placement.scaleY,
        scaleZ: placement.scaleZ,
      });

      this.clearGhostMesh();
      if (placedItem) {
        this.showSelectedToolbar(placedItem);
      }
    } finally {
      this.isPlacing = false;
    }
  }

  rotateFurniture(id: string, deltaRotY: number): void {
    const item = this.furnitureManager.allPlaced.get(id);
    if (!item) return;
    item.mesh.rotation.y += deltaRotY;

    if (this.pendingChanges.has(id)) {
      this.pendingChanges.get(id)!.rotY += deltaRotY;
    } else {
      this.pendingChanges.set(id, {
        id,
        itemId: item.itemId,
        assetUrl: `/assets/furniture/${item.itemId}.glb`,
        x: item.mesh.position.x,
        y: item.mesh.position.y,
        z: item.mesh.position.z,
        rotY: item.mesh.rotation.y,
        scaleX: item.mesh.scaling.x,
        scaleY: item.mesh.scaling.y,
        scaleZ: item.mesh.scaling.z,
        isNew: false,
        isRemoved: false,
      });
    }
  }

  removeFurniture(id: string): void {
    this.furnitureManager.removeItem(id);
    if (this.pendingChanges.has(id)) {
      this.pendingChanges.get(id)!.isRemoved = true;
    } else {
      this.pendingChanges.set(id, {
        id,
        itemId: '',
        assetUrl: '',
        x: 0,
        y: 0,
        z: 0,
        rotY: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
        isNew: false,
        isRemoved: true,
      });
    }
    this.removeContextMenu();
    this.selectedFurniture = null;
  }

  // ─── Grid Snapping ────────────────────────────────────────────────────────
  public snapToGrid(pos: BABYLON.Vector3): BABYLON.Vector3 {
    let snappedX = pos.x;
    let snappedZ = pos.z;
    if (this.snapEnabled) {
      const snap = 0.5;
      snappedX = Math.round(pos.x / snap) * snap;
      snappedZ = Math.round(pos.z / snap) * snap;
    }
    let snappedY = this.floorY;
    if (this.ghostMesh) {
      const bb = this.ghostMesh.getBoundingInfo().boundingBox;
      snappedY = this.floorY + bb.extendSize.y;
    }
    return new BABYLON.Vector3(snappedX, snappedY, snappedZ);
  }

  // ─── Context Menu ─────────────────────────────────────────────────────────
  private showContextMenu(item: PlacedFurniture, evt: PointerEvent): void {
    this.removeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'furniture-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${evt.clientX}px;
      top: ${evt.clientY}px;
      background: #1a1a2e;
      border: 1px solid #4ecdc4;
      border-radius: 6px;
      color: #e0e0e0;
      z-index: 9998;
      font-family: Calibri, sans-serif;
      font-size: 11pt;
      min-width: 140px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());

    const options = [
      {
        label: '✋ Move',
        action: () => {
          this.removeFurniture(item.id);
          this.startPlacement(item.itemId, `/assets/furniture/${item.itemId}.glb`);
        },
      },
      {
        label: '🔄 Rotate 90°',
        action: () => this.cycleRotation(),
      },
      {
        label: '🗑️ Put Away',
        action: () => this.removeFurniture(item.id),
      },
    ];

    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.style.cssText = `
        display: block;
        width: 100%;
        background: none;
        border: none;
        color: #e0e0e0;
        padding: 8px 16px;
        text-align: left;
        cursor: pointer;
        font-size: 11pt;
        font-family: Calibri, sans-serif;
      `;
      btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(78,205,196,0.2)'));
      btn.addEventListener('mouseleave', () => (btn.style.background = 'none'));
      btn.addEventListener('click', () => {
        opt.action();
        this.removeContextMenu();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;

    setTimeout(() => {
      document.addEventListener('click', () => this.removeContextMenu(), { once: true });
    }, 0);
  }

  private removeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }

  // ─── Selected Item Floating Toolbar ───────────────────────────────────────
  private showSelectedToolbar(item: PlacedFurniture): void {
    this.removeSelectedToolbar();
    this.selectedFurniture = item;
    try {
      item.mesh.showBoundingBox = true;
      item.mesh.getChildMeshes().forEach((m) => (m.showBoundingBox = true));
    } catch {}

    // Attach distinct teal highlight to selected furniture
    if (!this.editorHighlightLayer && this.scene.getEngine().getRenderingCanvas()) {
      try {
        this.editorHighlightLayer = new BABYLON.HighlightLayer('editor_hl', this.scene, { isStroke: true });
      } catch {}
    }
    if (this.editorHighlightLayer) {
      if (item.mesh instanceof BABYLON.Mesh) {
        try {
          this.editorHighlightLayer.addMesh(item.mesh, BABYLON.Color3.FromHexString('#4ecdc4'));
        } catch {}
      }
      item.mesh.getChildMeshes().forEach((m) => {
        if (m instanceof BABYLON.Mesh) {
          try {
            this.editorHighlightLayer?.addMesh(m, BABYLON.Color3.FromHexString('#4ecdc4'));
          } catch {}
        }
      });
    }

    const toolbar = document.createElement('div');
    toolbar.id = 'furniture-selected-toolbar';
    toolbar.style.cssText = `
      position: fixed;
      top: 75px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 15, 35, 0.95);
      border: 1px solid #4ecdc4;
      border-radius: 8px;
      padding: 8px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 9100;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      font-family: Calibri, sans-serif;
    `;
    toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());

    const title = document.createElement('span');
    title.textContent = `Selected: ${item.itemId.replace('furniture-', '')}`;
    title.style.cssText = 'color: #4ecdc4; font-size: 10.5pt; font-weight: 600; margin-right: 6px; text-transform: capitalize;';

    const btnMove = document.createElement('button');
    btnMove.id = 'btn-furniture-move';
    btnMove.innerHTML = '✋ Move';
    btnMove.style.cssText = `
      background: #4ecdc4;
      color: #0d0d1a;
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 9.5pt;
      font-weight: 600;
      cursor: pointer;
    `;
    btnMove.onclick = () => {
      const itemId = item.itemId;
      this.removeFurniture(item.id);
      this.removeSelectedToolbar();
      this.startPlacement(itemId, `/assets/furniture/${itemId}.glb`);
    };

    const btnRotate = document.createElement('button');
    btnRotate.id = 'btn-furniture-rotate';
    btnRotate.innerHTML = '🔄 Rotate 90° (R)';
    btnRotate.style.cssText = `
      background: rgba(139, 92, 246, 0.3);
      border: 1px solid #8b5cf6;
      color: #c084fc;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 9.5pt;
      font-weight: 600;
      cursor: pointer;
    `;
    btnRotate.onclick = () => {
      this.cycleRotation();
    };

    const btnRemove = document.createElement('button');
    btnRemove.id = 'btn-furniture-remove';
    btnRemove.innerHTML = '🗑️ Put Away';
    btnRemove.style.cssText = `
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid #ef4444;
      color: #f87171;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 9.5pt;
      font-weight: 600;
      cursor: pointer;
    `;
    btnRemove.onclick = () => {
      this.removeFurniture(item.id);
      this.removeSelectedToolbar();
    };

    const btnClose = document.createElement('button');
    btnClose.id = 'btn-furniture-deselect';
    btnClose.innerHTML = '✕';
    btnClose.style.cssText = `
      background: transparent;
      border: none;
      color: #888;
      font-size: 13pt;
      cursor: pointer;
      padding: 0 4px;
    `;
    btnClose.onclick = () => {
      this.removeSelectedToolbar();
    };

    toolbar.appendChild(title);
    toolbar.appendChild(btnMove);
    toolbar.appendChild(btnRotate);
    toolbar.appendChild(btnRemove);
    toolbar.appendChild(btnClose);

    document.body.appendChild(toolbar);
    this.selectedToolbar = toolbar;
  }

  private removeSelectedToolbar(): void {
    if (this.selectedFurniture?.mesh) {
      try {
        this.selectedFurniture.mesh.showBoundingBox = false;
        this.selectedFurniture.mesh.getChildMeshes().forEach((m) => (m.showBoundingBox = false));
      } catch {}
      if (this.editorHighlightLayer) {
        try {
          if (this.selectedFurniture.mesh instanceof BABYLON.Mesh) {
            this.editorHighlightLayer.removeMesh(this.selectedFurniture.mesh);
          }
          this.selectedFurniture.mesh.getChildMeshes().forEach((m) => {
            if (m instanceof BABYLON.Mesh) {
              this.editorHighlightLayer?.removeMesh(m);
            }
          });
        } catch {}
      }
    }
    this.selectedToolbar?.remove();
    this.selectedToolbar = null;
  }

  // ─── Inventory Panel ──────────────────────────────────────────────────────
  private buildInventoryPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'room-editor-inventory';
    panel.style.cssText = `
      position: fixed;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(20, 20, 40, 0.95);
      border: 1px solid #4ecdc4;
      border-radius: 8px;
      width: 220px;
      max-height: 75vh;
      overflow-y: auto;
      z-index: 9000;
      font-family: Calibri, sans-serif;
      color: #e0e0e0;
      padding: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    `;
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    panel.innerHTML = `
      <h4 style="margin: 0 0 8px; color: #4ecdc4; font-size: 12pt; display: flex; justify-content: space-between; align-items: center;">
        <span>🛋️ Decorator</span>
        <button id="btn-close-editor" style="background:none; border:none; color:#888; cursor:pointer; font-size:14pt;">✕</button>
      </h4>

      <!-- Grid & Snap Toggles -->
      <div style="display: flex; gap: 6px; margin-bottom: 8px;">
        <button id="btn-toggle-grid" style="flex: 1; padding: 4px 6px; font-size: 8pt; border-radius: 4px; border: 1px solid ${this.gridVisible ? '#4ecdc4' : '#475569'}; background: ${this.gridVisible ? 'rgba(78, 205, 196, 0.2)' : 'transparent'}; color: #fff; cursor: pointer; font-weight: 600;">
          Grid: ${this.gridVisible ? 'ON' : 'OFF'}
        </button>
        <button id="btn-toggle-snap" style="flex: 1; padding: 4px 6px; font-size: 8pt; border-radius: 4px; border: 1px solid ${this.snapEnabled ? '#4ecdc4' : '#475569'}; background: ${this.snapEnabled ? 'rgba(78, 205, 196, 0.2)' : 'transparent'}; color: #fff; cursor: pointer; font-weight: 600;">
          Snap: ${this.snapEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <!-- Mode Tabs: Furniture vs Floors & Walls -->
      <div style="display: flex; gap: 4px; margin-bottom: 8px; border-bottom: 1px solid #334155; padding-bottom: 6px;">
        <button id="tab-editor-furniture" style="flex: 1; padding: 4px; font-size: 8.5pt; font-weight: 600; border-radius: 4px; border: none; background: #3b82f6; color: #fff; cursor: pointer;">Items</button>
        <button id="tab-editor-surfaces" style="flex: 1; padding: 4px; font-size: 8.5pt; font-weight: 600; border-radius: 4px; border: none; background: transparent; color: #94a3b8; cursor: pointer;">Surfaces</button>
      </div>

      <div id="editor-furniture-section">
        <p style="font-size: 8pt; color: #94a3b8; margin: 0 0 8px;">
          Click or drag item to canvas. Press <strong>[R]</strong> to rotate!
        </p>
        <button id="btn-editor-rotate" style="width: 100%; background: rgba(139, 92, 246, 0.25); border: 1px solid #8b5cf6; border-radius: 6px; color: #c084fc; padding: 7px 10px; font-weight: 600; cursor: pointer; font-size: 9.5pt; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span>🔄 Orientation:</span>
          <span id="editor-rot-label" style="color: #fff;">0° (South)</span>
        </button>
        <div id="editor-inventory-list">Loading inventory…</div>
      </div>

      <div id="editor-surfaces-section" style="display: none;">
        <div style="font-size: 8.5pt; font-weight: 600; color: #38bdf8; margin-bottom: 6px;">Floor Material</div>
        <div id="editor-floor-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px;">
          <button class="surface-btn" data-type="floor" data-key="floor-wood-oak" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🪵 Honey Oak</button>
          <button class="surface-btn" data-type="floor" data-key="floor-tile-marble" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🏛️ Marble Tile</button>
          <button class="surface-btn" data-type="floor" data-key="floor-carpet-teal" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🟦 Teal Plush</button>
          <button class="surface-btn" data-type="floor" data-key="floor-wood-dark" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🌲 Walnut</button>
        </div>

        <div style="font-size: 8.5pt; font-weight: 600; color: #38bdf8; margin-bottom: 6px;">Wall Material</div>
        <div id="editor-wall-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <button class="surface-btn" data-type="wall" data-key="wall-plaster-white" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">⚪ Clean White</button>
          <button class="surface-btn" data-type="wall" data-key="wall-brick-warm" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🧱 Warm Brick</button>
          <button class="surface-btn" data-type="wall" data-key="wall-wallpaper-navy" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🌌 Navy Starlight</button>
          <button class="surface-btn" data-type="wall" data-key="wall-wood-panel" style="padding: 6px; font-size: 8pt; background: #1e293b; border: 1px solid #475569; border-radius: 4px; color: #fff; cursor: pointer;">🪵 Shiplap</button>
        </div>
      </div>
    `;

    // Toggle Grid Click
    const btnGrid = panel.querySelector('#btn-toggle-grid') as HTMLButtonElement | null;
    btnGrid?.addEventListener('click', () => {
      this.gridVisible = !this.gridVisible;
      if (this.gridVisible) {
        this.showGrid();
      } else {
        this.hideGrid();
      }
      btnGrid.textContent = `Grid: ${this.gridVisible ? 'ON' : 'OFF'}`;
      btnGrid.style.borderColor = this.gridVisible ? '#4ecdc4' : '#475569';
      btnGrid.style.background = this.gridVisible ? 'rgba(78, 205, 196, 0.2)' : 'transparent';
    });

    // Toggle Snap Click
    const btnSnap = panel.querySelector('#btn-toggle-snap') as HTMLButtonElement | null;
    btnSnap?.addEventListener('click', () => {
      this.snapEnabled = !this.snapEnabled;
      btnSnap.textContent = `Snap: ${this.snapEnabled ? 'ON' : 'OFF'}`;
      btnSnap.style.borderColor = this.snapEnabled ? '#4ecdc4' : '#475569';
      btnSnap.style.background = this.snapEnabled ? 'rgba(78, 205, 196, 0.2)' : 'transparent';
    });

    // Tab Switching
    const tabFurniture = panel.querySelector('#tab-editor-furniture') as HTMLButtonElement | null;
    const tabSurfaces = panel.querySelector('#tab-editor-surfaces') as HTMLButtonElement | null;
    const secFurniture = panel.querySelector('#editor-furniture-section') as HTMLElement | null;
    const secSurfaces = panel.querySelector('#editor-surfaces-section') as HTMLElement | null;

    tabFurniture?.addEventListener('click', () => {
      tabFurniture.style.background = '#3b82f6';
      tabFurniture.style.color = '#fff';
      if (tabSurfaces) {
        tabSurfaces.style.background = 'transparent';
        tabSurfaces.style.color = '#94a3b8';
      }
      if (secFurniture) secFurniture.style.display = 'block';
      if (secSurfaces) secSurfaces.style.display = 'none';
    });

    tabSurfaces?.addEventListener('click', () => {
      tabSurfaces.style.background = '#3b82f6';
      tabSurfaces.style.color = '#fff';
      if (tabFurniture) {
        tabFurniture.style.background = 'transparent';
        tabFurniture.style.color = '#94a3b8';
      }
      if (secFurniture) secFurniture.style.display = 'none';
      if (secSurfaces) secSurfaces.style.display = 'block';
    });

    // Surface option click handler
    panel.querySelectorAll('.surface-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = (btn as HTMLElement).dataset.type;
        const key = (btn as HTMLElement).dataset.key;
        if (!key) return;

        // Visual active swatch glow highlight
        panel.querySelectorAll(`.surface-btn[data-type="${type}"]`).forEach((b) => {
          (b as HTMLElement).style.border = '1px solid #475569';
          (b as HTMLElement).style.boxShadow = 'none';
        });
        (btn as HTMLElement).style.border = '2px solid #4ecdc4';
        (btn as HTMLElement).style.boxShadow = '0 0 8px rgba(78, 205, 196, 0.6)';

        // Apply immediately in Babylon scene for instant feedback
        applyRoomSurfaces(this.scene, type === 'floor' ? key : undefined, type === 'wall' ? key : undefined);

        try {
          const token = authService.token || (await authService.getToken()) || '';
          const res = await fetch(`${SERVER_URL}/api/rooms/${this.roomId}/surfaces`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              [type === 'floor' ? 'floorTexture' : 'wallTexture']: key,
            }),
          });
          if (res.ok) {
            audioEngine.playFurniturePlace();
            showToast({ icon: '🎨', title: 'Surface Updated', subtitle: `${key} applied.` });
          } else {
            audioEngine.playError();
            showToast({ icon: '⚠️', title: 'Surface Error', subtitle: 'Could not update surface.' });
          }
        } catch {
          audioEngine.playError();
          showToast({ icon: '⚠️', title: 'Surface Error', subtitle: 'Could not update surface.' });
        }
      });
    });

    panel.querySelector('#btn-editor-rotate')?.addEventListener('click', () => this.cycleRotation());

    const loadInventory = async () => {
      const list = panel.querySelector('#editor-inventory-list');
      if (!list) return;

      try {
        const token = authService.token || (await authService.getToken()) || '';
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${SERVER_URL}/api/users/me/inventory?type=furniture`, {
          headers,
          credentials: 'include',
        });

        if (!res.ok) {
          list.innerHTML = `<p style="color:#ef4444; font-size:9pt;">Failed to load inventory (${res.status})</p>`;
          return;
        }

        const items: Array<{ itemId: string; name: string; assetUrl: string; quantity: number }> = await res.json();
        if (!items.length) {
          list.innerHTML = '<p style="color:#888; font-size:9.5pt;">No furniture owned.</p>';
          return;
        }

        list.innerHTML = '';
        items.forEach((item) => {
          const btn = document.createElement('button');
          btn.textContent = `${item.name} (x${item.quantity})`;
          btn.title = `Place ${item.name}`;
          btn.className = 'editor-inventory-item-btn';
          btn.setAttribute('data-item-id', item.itemId);
          btn.style.cssText = `
            display: block;
            width: 100%;
            background: #0f0f23;
            border: 1px solid #2a2a4a;
            border-radius: 4px;
            color: #e0e0e0;
            padding: 8px 10px;
            margin-bottom: 8px;
            text-align: left;
            cursor: pointer;
            font-size: 10pt;
            transition: border-color 150ms;
          `;
          btn.addEventListener('mouseenter', () => {
            if (!btn.classList.contains('active-item')) btn.style.borderColor = '#4ecdc4';
          });
          btn.addEventListener('mouseleave', () => {
            if (!btn.classList.contains('active-item')) btn.style.borderColor = '#2a2a4a';
          });
          btn.addEventListener('click', () => {
            list.querySelectorAll('.editor-inventory-item-btn').forEach((b) => {
              (b as HTMLElement).style.borderColor = '#2a2a4a';
              (b as HTMLElement).style.background = '#0f0f23';
              b.classList.remove('active-item');
            });
            btn.classList.add('active-item');
            btn.style.borderColor = '#4ecdc4';
            btn.style.background = 'rgba(78, 205, 196, 0.2)';
            showToast({
              icon: '🛋️',
              title: `Placing ${item.name}`,
              subtitle: 'Click anywhere on the room floor to place. Press [R] to rotate.',
            });
            this.startPlacement(item.itemId, item.assetUrl);
          });
          list.appendChild(btn);
        });
      } catch (err) {
        console.error('[RoomEditor] Error loading inventory:', err);
        list.innerHTML = '<p style="color:#ef4444; font-size:9pt;">Error loading inventory</p>';
      }
    };

    loadInventory();

    // Save & Cancel Action Buttons
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top: 16px; border-top: 1px solid #333; padding-top: 10px; display: flex; flex-direction: column; gap: 6px;';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'btn-save-layout';
    saveBtn.textContent = '💾 Save Layout';
    saveBtn.style.cssText = `
      width: 100%;
      background: #4ecdc4;
      color: #0d0d1a;
      border: none;
      border-radius: 4px;
      padding: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 10.5pt;
    `;
    saveBtn.addEventListener('click', () => this.saveLayout());

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'btn-cancel-layout';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      width: 100%;
      background: transparent;
      color: #aaa;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 7px;
      cursor: pointer;
      font-size: 10pt;
    `;
    cancelBtn.addEventListener('click', () => this.cancelEdit());

    footer.appendChild(saveBtn);
    footer.appendChild(cancelBtn);
    panel.appendChild(footer);

    panel.querySelector('#btn-close-editor')?.addEventListener('click', () => this.cancelEdit());

    document.body.appendChild(panel);
  }

  private removeInventoryPanel(): void {
    document.getElementById('room-editor-inventory')?.remove();
  }

  // ─── Save / Cancel ────────────────────────────────────────────────────────
  async saveLayout(): Promise<void> {
    const layout = Array.from(this.furnitureManager.allPlaced.values()).map((item) => ({
      id: item.id,
      itemId: item.itemId,
      assetUrl: `/assets/furniture/${item.itemId}.glb`,
      x: item.mesh.position.x,
      y: item.mesh.position.y,
      z: item.mesh.position.z,
      rotY: item.mesh.rotation.y,
      scaleX: item.mesh.scaling.x,
      scaleY: item.mesh.scaling.y,
      scaleZ: item.mesh.scaling.z,
    }));

    try {
      const token = authService.token || (await authService.getToken()) || '';
      const csrfToken = authService.getCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`${SERVER_URL}/api/rooms/${this.roomId}/furniture/layout`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ layout }),
      });

      if (!res.ok) {
        audioEngine.playError();
        showToast({
          icon: '❌',
          title: 'Save failed',
          subtitle: `Server returned HTTP ${res.status} — your layout was not saved.`,
        });
        return;
      }

      this.pendingChanges.clear();
      this.removeSelectedToolbar();
      this.exitEditMode();
      audioEngine.playSuccess();
      showToast({
        icon: '💾',
        title: 'Room layout saved!',
        subtitle: 'Your furniture changes are live.',
      });
      console.log('[RoomEditor] Layout saved successfully.');
    } catch (err) {
      console.error('[RoomEditor] Save error:', err);
      audioEngine.playError();
      showToast({
        icon: '❌',
        title: 'Save failed',
        subtitle: 'Could not reach the server. Please try again.',
      });
    }
  }

  cancelEdit(): void {
    if (this.pendingChanges.size > 0) {
      const confirmDiscard = window.confirm('You have unsaved furniture layout changes. Discard changes?');
      if (!confirmDiscard) return;
    }
    // Reload furniture from server (discard pending changes)
    this.furnitureManager.clear();
    this.furnitureManager.loadRoomFurniture(this.roomId);
    this.pendingChanges.clear();
    this.removeSelectedToolbar();
    this.exitEditMode();
    showToast({ icon: '↩️', title: 'Changes discarded' });
  }

  dispose(): void {
    this.exitEditMode();
  }
}
