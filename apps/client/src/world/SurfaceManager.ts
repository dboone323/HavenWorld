import * as BABYLON from '@babylonjs/core';

export interface RoomSurfaces {
  floorTexture?: string;
  wallTexture?: string;
}

export function applyRoomSurfaces(
  scene: BABYLON.Scene,
  floorKey?: string | null,
  wallKey?: string | null
): void {
  // ── 1. Apply Floor Surfaces ───────────────────────────────────────────────
  if (floorKey) {
    const floorMeshes = scene.meshes.filter((m) => {
      const n = m.name.toLowerCase();
      return (
        m.name === 'Floor' ||
        (n.includes('floor') && !n.includes('lip') && !n.includes('grid')) ||
        (m.metadata?.walkable && !n.includes('lip') && !n.includes('grid'))
      );
    });

    for (const m of floorMeshes) {
      if (m.material && m.material.name.startsWith('floor_mat_')) {
        m.material.dispose();
      }
      const mat = new BABYLON.StandardMaterial(`floor_mat_${floorKey}`, scene);
      switch (floorKey) {
        case 'floor-wood-oak':
        case 'wood_herringbone':
          mat.diffuseColor = new BABYLON.Color3(0.82, 0.64, 0.44); // Honey Oak
          mat.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
          break;
        case 'floor-tile-marble':
        case 'marble_white':
        case 'tile_checkered':
          mat.diffuseColor = new BABYLON.Color3(0.94, 0.96, 0.98); // Marble Tile
          mat.specularColor = new BABYLON.Color3(0.45, 0.45, 0.45);
          break;
        case 'floor-carpet-teal':
          mat.diffuseColor = new BABYLON.Color3(0.12, 0.58, 0.58); // Teal Plush
          mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
          break;
        case 'floor-wood-dark':
          mat.diffuseColor = new BABYLON.Color3(0.32, 0.20, 0.12); // Walnut
          mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
          break;
        default:
          mat.diffuseColor = new BABYLON.Color3(0.82, 0.64, 0.44);
      }
      m.material = mat;
    }
  }

  // ── 2. Apply Wall Surfaces ────────────────────────────────────────────────
  if (wallKey) {
    const wallMeshes = scene.meshes.filter((m) => {
      const n = m.name.toLowerCase();
      return n.startsWith('wall_') || (n.includes('wall') && !n.includes('walkable'));
    });

    for (const m of wallMeshes) {
      if (m.material && m.material.name.startsWith('wall_mat_')) {
        m.material.dispose();
      }
      const mat = new BABYLON.StandardMaterial(`wall_mat_${wallKey}`, scene);
      switch (wallKey) {
        case 'wall-plaster-white':
          mat.diffuseColor = new BABYLON.Color3(0.97, 0.97, 0.99); // Clean White Plaster
          mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
          break;
        case 'wall-brick-warm':
        case 'brick_exposed':
          mat.diffuseColor = new BABYLON.Color3(0.72, 0.28, 0.22); // Warm Brick
          mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
          break;
        case 'wall-wallpaper-navy':
          mat.diffuseColor = new BABYLON.Color3(0.08, 0.12, 0.24); // Navy Starlight
          mat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.12);
          break;
        case 'wall-wood-panel':
          mat.diffuseColor = new BABYLON.Color3(0.84, 0.78, 0.70); // Rustic Shiplap
          mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
          break;
        default:
          mat.diffuseColor = new BABYLON.Color3(0.97, 0.97, 0.99);
      }
      m.material = mat;
    }
  }
}

/**
 * Computes elevated Y position when stacking a furniture mesh on top of a surface mesh
 * (e.g. placing a lamp or plant onto a coffee table, dining table, or media console).
 */
export function computeStackingHeight(
  surfaceMesh: BABYLON.AbstractMesh | null | undefined,
  placingMesh: BABYLON.AbstractMesh | null | undefined,
  floorY: number = 0
): number {
  if (!surfaceMesh) {
    if (placingMesh) {
      const bb = placingMesh.getBoundingInfo().boundingBox;
      return floorY + bb.extendSize.y;
    }
    return floorY;
  }

  const name = surfaceMesh.name.toLowerCase();
  const isFloorOrRug =
    name === 'floor' ||
    name === 'editor_grid' ||
    name === 'placeholder_ground' ||
    name.startsWith('walkable') ||
    name.includes('rug');

  if (isFloorOrRug) {
    if (placingMesh) {
      const bb = placingMesh.getBoundingInfo().boundingBox;
      return floorY + bb.extendSize.y;
    }
    return floorY;
  }

  surfaceMesh.computeWorldMatrix(true);
  const surfaceBounds = surfaceMesh.getBoundingInfo().boundingBox;
  const topY = surfaceBounds.maximumWorld.y;

  if (placingMesh) {
    const placingBb = placingMesh.getBoundingInfo().boundingBox;
    return topY + placingBb.extendSize.y;
  }

  return topY;
}
