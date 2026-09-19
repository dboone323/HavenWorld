import * as BABYLON from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import type { FurnitureManager, PlacedFurniture } from './FurnitureManager';
import { SERVER_URL } from '../config';

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
  private furnitureManager: FurnitureManager;
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

  private currentRotation = 0; // 0, 90, 180, 270 degrees
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;

  // Tracks changes in this edit session
  private pendingChanges: Map<string, FurniturePlacement> = new Map();

  constructor(scene: BABYLON.Scene, furnitureManager: FurnitureManager, roomId: string, floorY = 0) {
    this.scene = scene;
    this.furnitureManager = furnitureManager;
    this.roomId = roomId;
    this.floorY = floorY;
  }

  // ─── Enter / Exit Edit Mode ───────────────────────────────────────────────
  enterEditMode(): void {
    if (this.isEditing) return;
    this.isEditing = true;
    this.pendingChanges.clear();
    this.showGrid();
    this.attachPointerObserver();
    this.buildInventoryPanel();

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
    this.selectedFurniture = null;

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
  private showGrid(): void {
    this.gridMesh = BABYLON.MeshBuilder.CreateGround(
      'editor_grid',
      { width: 30, height: 30, subdivisions: 60 },
      this.scene
    );
    this.gridMesh.position.y = this.floorY + 0.002; // slightly above floor
    this.gridMesh.isPickable = false;

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

  private hideGrid(): void {
    this.gridMesh?.dispose();
    this.gridMesh = null;
  }

  // ─── Ghost Mesh (Placement Preview) ───────────────────────────────────────
  async startPlacement(itemId: string, assetUrl?: string): Promise<void> {
    this.clearGhostMesh();
    this.ghostItemId = itemId;
    this.ghostAssetUrl = assetUrl || `/assets/furniture/${itemId}.glb`;

    const pathParts = this.ghostAssetUrl.split('/');
    const fileName = pathParts.pop()!;
    const folder = pathParts.join('/') + '/';

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', folder, fileName, this.scene);
      this.ghostMesh = result.meshes[0];
      this.ghostMesh.name = 'ghost_placement';
      this.ghostMesh.isPickable = false;
      this.ghostMesh.rotation.y = (this.currentRotation * Math.PI) / 180;

      // Apply translucent blue material to all sub-meshes
      result.meshes.forEach((mesh) => {
        const ghostMat = new BABYLON.StandardMaterial(`ghost_mat_${mesh.name}`, this.scene);
        ghostMat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 1.0);
        ghostMat.alpha = 0.55;
        ghostMat.backFaceCulling = false;
        mesh.material = ghostMat;
        mesh.isPickable = false;
      });
    } catch (err) {
      console.error('[RoomEditor] Error creating ghost mesh:', err);
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
          const evt = pointerInfo.event as PointerEvent;
          if (evt.button === 0) this.onPointerDown();
          if (evt.button === 2) this.onRightClick(evt);
          break;
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
      this.placeFurnitureFromGhost();
      return;
    }
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (pick) {
      const hit = this.furnitureManager.pickFurniture(pick);
      this.selectedFurniture = hit ?? null;
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
    if (!this.ghostMesh || !this.ghostItemId || !this.ghostAssetUrl) return;
    const pos = this.ghostMesh.position.clone();
    const rotRad = this.ghostMesh.rotation.y;
    const tempId = `new_${crypto.randomUUID()}`;

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

    await this.furnitureManager.placeItem({
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
  private snapToGrid(pos: BABYLON.Vector3): BABYLON.Vector3 {
    const snap = 0.5;
    const snappedX = Math.round(pos.x / snap) * snap;
    const snappedZ = Math.round(pos.z / snap) * snap;
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

    const options = [
      {
        label: 'Move',
        action: () => {
          this.removeFurniture(item.id);
          this.startPlacement(item.itemId, `/assets/furniture/${item.itemId}.glb`);
        },
      },
      {
        label: 'Rotate 90°',
        action: () => this.rotateFurniture(item.id, Math.PI / 2),
      },
      {
        label: 'Remove',
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

    panel.innerHTML = `
      <h4 style="margin: 0 0 8px; color: #4ecdc4; font-size: 12pt; display: flex; justify-content: space-between; align-items: center;">
        <span>🛋️ Decorator</span>
        <button id="btn-close-editor" style="background:none; border:none; color:#888; cursor:pointer; font-size:14pt;">✕</button>
      </h4>
      <p style="font-size: 8pt; color: #94a3b8; margin: 0 0 8px;">
        Click to place. Press <strong>[R]</strong> to rotate 4-ways (360°)!
      </p>
      <button id="btn-editor-rotate" style="width: 100%; background: rgba(139, 92, 246, 0.25); border: 1px solid #8b5cf6; border-radius: 6px; color: #c084fc; padding: 7px 10px; font-weight: 600; cursor: pointer; font-size: 9.5pt; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <span>🔄 Orientation:</span>
        <span id="editor-rot-label" style="color: #fff;">0° (South)</span>
      </button>
      <div id="editor-inventory-list">Loading inventory…</div>
    `;

    panel.querySelector('#btn-editor-rotate')?.addEventListener('click', () => this.cycleRotation());

    fetch(`${SERVER_URL}/api/users/me/inventory?type=furniture`, { credentials: 'include' })
      .then((r) => r.json())
      .then((items: Array<{ itemId: string; name: string; assetUrl: string; quantity: number }>) => {
        const list = panel.querySelector('#editor-inventory-list');
        if (!list) return;
        if (!items.length) {
          list.innerHTML = '<p style="color:#888; font-size:9.5pt;">No furniture owned.</p>';
          return;
        }
        list.innerHTML = '';
        items.forEach((item) => {
          const btn = document.createElement('button');
          btn.textContent = `${item.name} (x${item.quantity})`;
          btn.title = `Place ${item.name}`;
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
          btn.addEventListener('mouseenter', () => (btn.style.borderColor = '#4ecdc4'));
          btn.addEventListener('mouseleave', () => (btn.style.borderColor = '#2a2a4a'));
          btn.addEventListener('click', () => this.startPlacement(item.itemId, item.assetUrl));
          list.appendChild(btn);
        });
      })
      .catch((err) => {
        console.error('[RoomEditor] Error loading inventory:', err);
      });

    // Save & Cancel Action Buttons
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top: 16px; border-top: 1px solid #333; padding-top: 10px; display: flex; flex-direction: column; gap: 6px;';

    const saveBtn = document.createElement('button');
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
    const layout = Array.from(this.pendingChanges.values()).filter((p) => !p.isRemoved);

    try {
      const res = await fetch(`${SERVER_URL}/api/rooms/${this.roomId}/furniture/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ layout }),
      });

      if (!res.ok) {
        alert(`Failed to save layout: HTTP ${res.status}. Please try again.`);
        return;
      }

      this.pendingChanges.clear();
      this.exitEditMode();
      console.log('[RoomEditor] Layout saved successfully.');
    } catch (err) {
      console.error('[RoomEditor] Save error:', err);
      alert('Error connecting to server to save layout.');
    }
  }

  cancelEdit(): void {
    // Reload furniture from server (discard pending changes)
    this.furnitureManager.clear();
    this.furnitureManager.loadRoomFurniture(this.roomId);
    this.pendingChanges.clear();
    this.exitEditMode();
  }

  dispose(): void {
    this.exitEditMode();
  }
}
