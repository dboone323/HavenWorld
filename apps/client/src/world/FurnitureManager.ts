import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';
import type { FurniturePlacementData } from '@havenworld/shared';
import { SERVER_URL } from '../config';

export interface PlacedFurniture {
  id: string;
  itemId: string;
  mesh: BABYLON.AbstractMesh;
  isOwned: boolean;
}

export class FurnitureManager {
  private scene: BABYLON.Scene;
  private currentUserId: string;
  private placed: Map<string, PlacedFurniture> = new Map();
  // GLB template cache: itemId -> root mesh template
  private templateCache: Map<string, BABYLON.AbstractMesh> = new Map();

  constructor(scene: BABYLON.Scene, currentUserId: string) {
    this.scene = scene;
    this.currentUserId = currentUserId;
  }

  public registerTemplate(itemId: string, mesh: BABYLON.AbstractMesh): void {
    mesh.setEnabled(false);
    mesh.name = `template_${itemId}`;
    this.templateCache.set(itemId, mesh);
  }

  // ─── Load Room Furniture ──────────────────────────────────────────────────
  async loadRoomFurniture(roomId: string): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/furniture`, {
        credentials: 'include',
      });
      if (!res.ok) {
        console.error(`[FurnitureManager] Failed to fetch furniture for room ${roomId}`);
        return;
      }
      const items: FurniturePlacementData[] = await res.json();
      await Promise.all(items.map((item) => this.placeItem(item)));
      console.log(`[FurnitureManager] Loaded ${items.length} furniture items.`);
    } catch (err) {
      console.error('[FurnitureManager] Error loading furniture:', err);
    }
  }

  // ─── Place a Single Item ──────────────────────────────────────────────────
  async placeItem(data: FurniturePlacementData): Promise<PlacedFurniture | null> {
    try {
      let instance: BABYLON.AbstractMesh;

      if (this.templateCache.has(data.itemId)) {
        // Re-use cached template via instancing (O(1) GPU geometry submission)
        const template = this.templateCache.get(data.itemId)!;
        if ((template as BABYLON.Mesh).createInstance) {
          instance = (template as BABYLON.Mesh).createInstance(`${data.itemId}_${data.id}`);
        } else {
          instance = template.clone(`${data.itemId}_${data.id}`, null) as BABYLON.AbstractMesh;
        }
      } else {
        // First load: import GLB and cache root/child mesh as template
        const assetPath = data.assetUrl?.startsWith('/')
          ? data.assetUrl
          : `/assets/furniture/${data.itemId}.glb`;
        const pathParts = assetPath.split('/');
        const fileName = pathParts.pop()!;
        const folder = pathParts.join('/') + '/';

        const result = await BABYLON.SceneLoader.ImportMeshAsync('', folder, fileName, this.scene);
        const root = result.meshes[0];
        root.setEnabled(false); // hide template
        root.name = `template_${data.itemId}`;
        this.templateCache.set(data.itemId, root);

        const meshToInstantiate =
          (root as BABYLON.Mesh).createInstance ? (root as BABYLON.Mesh) : (result.meshes[1] as BABYLON.Mesh);

        if (meshToInstantiate && meshToInstantiate.createInstance) {
          instance = meshToInstantiate.createInstance(`${data.itemId}_${data.id}`);
        } else {
          instance = root.clone(`${data.itemId}_${data.id}`, null) as BABYLON.AbstractMesh;
        }
      }

      instance.setEnabled(true);
      instance.position = new BABYLON.Vector3(data.x, data.y, data.z);
      instance.rotation = new BABYLON.Vector3(0, data.rotY, 0);
      instance.scaling = new BABYLON.Vector3(data.scaleX ?? 1, data.scaleY ?? 1, data.scaleZ ?? 1);
      instance.isPickable = true;

      const placedItem: PlacedFurniture = {
        id: data.id,
        itemId: data.itemId,
        mesh: instance,
        isOwned: data.placedById === this.currentUserId || data.placedById === 'local',
      };

      this.placed.set(data.id, placedItem);
      return placedItem;
    } catch (err) {
      console.error(`[FurnitureManager] Failed to place furniture item ${data.itemId}:`, err);
      return null;
    }
  }

  // ─── Picking ──────────────────────────────────────────────────────────────
  pickFurniture(pickInfo: BABYLON.PickingInfo): PlacedFurniture | null {
    if (!pickInfo.hit || !pickInfo.pickedMesh) return null;
    for (const [, pf] of this.placed) {
      if (pf.mesh === pickInfo.pickedMesh || pickInfo.pickedMesh.isDescendantOf(pf.mesh)) {
        return pf;
      }
    }
    return null;
  }

  // ─── Remove Item ──────────────────────────────────────────────────────────
  removeItem(id: string): void {
    const item = this.placed.get(id);
    if (item) {
      item.mesh.dispose();
      this.placed.delete(id);
    }
  }

  // ─── Clear Room ───────────────────────────────────────────────────────────
  clear(): void {
    this.placed.forEach((pf) => pf.mesh.dispose());
    this.placed.clear();
    this.templateCache.forEach((t) => t.dispose());
    this.templateCache.clear();
  }

  get allPlaced(): Map<string, PlacedFurniture> {
    return this.placed;
  }
}
