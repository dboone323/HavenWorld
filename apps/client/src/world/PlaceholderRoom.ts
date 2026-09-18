import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Tags,
  PointLight,
} from '@babylonjs/core';

/**
 * Creates a simple placeholder room using Babylon MeshBuilder primitives.
 * Used when no GLB room file is available. Replace with a real GLB in Part 5B.
 * Room dimensions: 30m × 30m floor, 4m walls.
 */
export function createPlaceholderRoom(scene: Scene): void {
  // ─── FLOOR ───────────────────────────────────────────────────────────────
  const floor = MeshBuilder.CreateGround(
    'Floor',
    { width: 30, height: 30, subdivisions: 1 },
    scene
  );
  const floorMat = new StandardMaterial('floor_mat', scene);
  floorMat.diffuseColor = new Color3(0.72, 0.68, 0.6);
  floor.material = floorMat;
  floor.isPickable = true;
  Tags.AddTagsTo(floor, 'walkable');

  // ─── WALLS ───────────────────────────────────────────────────────────────
  const wallMat = new StandardMaterial('wall_mat', scene);
  wallMat.diffuseColor = new Color3(0.88, 0.85, 0.8);

  const wallDefs = [
    { name: 'wall_north', pos: new Vector3(0, 2, -15), rot: 0 },
    { name: 'wall_south', pos: new Vector3(0, 2, 15), rot: 0 },
    { name: 'wall_east', pos: new Vector3(15, 2, 0), rot: Math.PI / 2 },
    { name: 'wall_west', pos: new Vector3(-15, 2, 0), rot: Math.PI / 2 },
  ];

  for (const def of wallDefs) {
    const wall = MeshBuilder.CreatePlane(def.name, { width: 30, height: 4 }, scene);
    wall.position.copyFrom(def.pos);
    wall.rotation.y = def.rot;
    wall.material = wallMat;
    wall.isPickable = false;
    wall.backFaceCulling = false;
  }

  // ─── AMBIENT POINT LIGHT ─────────────────────────────────────────────────
  const roomLight = new PointLight('room_light', new Vector3(0, 5, 0), scene);
  roomLight.intensity = 0.5;

  console.log('[PlaceholderRoom] Created 30×30m placeholder room.');
}
