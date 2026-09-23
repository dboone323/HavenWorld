import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';
import type { FurniturePlacementData } from '@havenworld/shared';
import { SERVER_URL, assetUrl } from '../config';
import { authService } from '../services/auth';

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
      const token = authService.token || (await authService.getToken()) || '';
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/furniture`, {
        headers,
        credentials: 'include',
      });
      if (!res.ok) {
        console.warn(`[FurnitureManager] Furniture for room ${roomId} returned ${res.status}`);
        return;
      }
      const items = await res.json();
      if (Array.isArray(items)) {
        await Promise.all(items.map((item: FurniturePlacementData) => this.placeItem(item)));
        console.log(`[FurnitureManager] Loaded ${items.length} furniture items.`);
      }
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
          ? assetUrl(data.assetUrl)
          : assetUrl(`/assets/furniture/${data.itemId}.glb`);
        const pathParts = assetPath.split('/');
        const fileName = pathParts.pop()!;
        const folder = pathParts.join('/') + '/';

        try {
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
        } catch {
          // Procedural fallback when GLB model is not packaged
          const dims = FurnitureManager.getProceduralDimensions(data.itemId);
          const box = BABYLON.MeshBuilder.CreateBox(`${data.itemId}_${data.id}`, dims, this.scene);
          const mat = new BABYLON.StandardMaterial(`mat_${data.itemId}_${data.id}`, this.scene);
          mat.diffuseColor = FurnitureManager.getProceduralColor(data.itemId);
          mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
          box.material = mat;
          box.metadata = { furniture: true, itemId: data.itemId };
          instance = box;
        }
      }

      instance.setEnabled(true);
      instance.position = new BABYLON.Vector3(data.x, data.y, data.z);
      instance.rotation = new BABYLON.Vector3(0, data.rotY, 0);
      instance.scaling = new BABYLON.Vector3(data.scaleX ?? 1, data.scaleY ?? 1, data.scaleZ ?? 1);
      instance.isPickable = true;
      instance.getChildMeshes().forEach((child) => {
        child.setEnabled(true);
        child.isPickable = true;
      });

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
      if (
        pf.mesh === pickInfo.pickedMesh ||
        pickInfo.pickedMesh.isDescendantOf(pf.mesh) ||
        pickInfo.pickedMesh.name.includes(pf.id) ||
        pickInfo.pickedMesh.name.includes(pf.itemId)
      ) {
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

  public static getProceduralDimensions(itemId: string): { width: number; height: number; depth: number } {
    const id = itemId.toLowerCase();
    if (id.includes('table') || id.includes('desk')) return { width: 1.6, height: 0.75, depth: 0.9 };
    if (id.includes('chair') || id.includes('stool')) return { width: 0.7, height: 0.9, depth: 0.7 };
    if (id.includes('sofa') || id.includes('couch')) return { width: 2.2, height: 0.85, depth: 1.0 };
    if (id.includes('bed')) return { width: 1.8, height: 0.6, depth: 2.2 };
    if (id.includes('lamp')) return { width: 0.4, height: 1.5, depth: 0.4 };
    if (id.includes('plant') || id.includes('pot')) return { width: 0.6, height: 0.9, depth: 0.6 };
    if (id.includes('shelf') || id.includes('bookcase')) return { width: 1.2, height: 1.8, depth: 0.45 };
    if (id.includes('rug') || id.includes('carpet')) return { width: 2.4, height: 0.04, depth: 1.8 };
    return { width: 1.0, height: 0.8, depth: 1.0 };
  }

  public static getProceduralColor(itemId: string): BABYLON.Color3 {
    const id = itemId.toLowerCase();
    if (id.includes('wood') || id.includes('oak')) return new BABYLON.Color3(0.65, 0.48, 0.35);
    if (id.includes('chair') || id.includes('stool')) return new BABYLON.Color3(0.75, 0.45, 0.3);
    if (id.includes('sofa') || id.includes('couch')) return new BABYLON.Color3(0.35, 0.45, 0.65);
    if (id.includes('plant')) return new BABYLON.Color3(0.2, 0.6, 0.3);
    if (id.includes('lamp')) return new BABYLON.Color3(0.9, 0.85, 0.4);
    if (id.includes('rug')) return new BABYLON.Color3(0.8, 0.75, 0.7);
    return new BABYLON.Color3(0.4, 0.6, 0.8);
  }
}
