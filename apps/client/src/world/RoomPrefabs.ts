import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Tags,
  PointLight,
  DirectionalLight,
  HemisphericLight,
  AbstractMesh,
} from '@babylonjs/core';
import { createPlaceholderRoom } from './PlaceholderRoom';

/**
 * Procedural room geometry generators for HavenWorld spaces.
 *
 * These fill the gap while GLB room assets are produced in Blender. Each
 * generator returns meshes tagged so RoomLoader.processMeshes() and the
 * FurnitureManager can pick them up uniformly (walkable / navmesh / collision /
 * interactable).
 *
 * Room IDs are defined in prisma/schema.prisma and apps/client/src/config.ts:
 *   - "room-park"        → Haven Park & Plaza (outdoor, public)
 *   - "room-cafe"        → The Cozy Café (indoor, semi-public)
 *   - personal loft IDs  → generated on user registration, backgroundKey "map-personal-room"
 *   - "room-town-square" → has a real GLB asset; falls through to this factory only if missing
 */

interface PrefabResult {
  meshes: AbstractMesh[];
  walkableMeshes: AbstractMesh[];
  interactableMeshes: AbstractMesh[];
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function makeMaterial(scene: Scene, name: string, color: [number, number, number]): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = new Color3(...color);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  return mat;
}

/**
 * Build an outdoor grass ground plane with a subtle texture tint,
 * tagged as 'walkable' so the avatar can stand on it.
 */
function buildGrassGround(scene: Scene, size: number, mat: StandardMaterial): AbstractMesh {
  const ground = MeshBuilder.CreateGround('Walkable_Ground', { width: size, height: size }, scene);
  ground.position.y = 0;
  ground.material = mat;
  ground.isPickable = true;
  ground.metadata = { walkable: true };
  Tags.AddTagsTo(ground, 'walkable');
  return ground;
}

/**
 * Build a shallow fountain central feature. The basin is tagged walkable
 * so the MovementValidator treats the water surface as traversable.
 */
function buildFountain(scene: Scene, x: number, z: number): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];
  const stoneMat = makeMaterial(scene, 'fountain_stone', [0.85, 0.85, 0.85]);
  const waterMat = makeMaterial(scene, 'fountain_water', [0.2, 0.55, 0.85]);
  waterMat.alpha = 0.7;

  // Basin
  const basin = MeshBuilder.CreateCylinder('fountain_basin', { diameter: 2.4, height: 0.4 }, scene);
  basin.position.set(x, 0.2, z);
  basin.material = stoneMat;
  basin.isPickable = true;
  basin.metadata = { walkable: true, interactable: 'fish' };
  Tags.AddTagsTo(basin, 'walkable interactable fishing_dock');
  meshes.push(basin);

  // Water surface (slightly above basin rim)
  const water = MeshBuilder.CreateDisc('fountain_water', { radius: 1.0 }, scene);
  water.position.set(x, 0.25, z);
  water.rotation.x = Math.PI / 2;
  water.material = waterMat;
  water.isPickable = false;
  meshes.push(water);

  // Central pillar
  const pillar = MeshBuilder.CreateCylinder('fountain_pillar', { diameter: 0.5, height: 1.2 }, scene);
  pillar.position.set(x, 0.8, z);
  pillar.material = stoneMat;
  meshes.push(pillar);

  // Lantern on top
  const lantern = MeshBuilder.CreateSphere('fountain_lantern', { diameter: 0.35 }, scene);
  lantern.position.set(x, 1.55, z);
  const light = new PointLight('fountain_light', new Vector3(x, 1.55, z), scene);
  light.intensity = 0.55;
  light.diffuse = new Color3(0.7, 0.85, 1.0);
  meshes.push(lantern);

  return meshes;
}

/**
 * Build a park bench that players can sit on.
 */
function buildBench(scene: Scene, x: number, z: number, rotY: number, mat: StandardMaterial): AbstractMesh {
  const root = MeshBuilder.CreateBox('park_bench_root', { size: 1 }, scene);
  root.position.set(x, 0, z);
  root.rotation.y = rotY;
  root.visibility = 0; // invisible root for grouping

  const seat = MeshBuilder.CreateBox('bench_seat', { width: 1.6, depth: 0.5, height: 0.15 }, scene);
  seat.parent = root;
  seat.position.y = 0.5;
  seat.material = mat;
  seat.isPickable = true;
  seat.metadata = { interactable: 'sit' };
  Tags.AddTagsTo(seat, 'interactable sit');

  const leg1 = MeshBuilder.CreateBox('bench_leg1', { width: 0.12, depth: 0.4, height: 0.45 }, scene);
  leg1.parent = root;
  leg1.position.set(-0.7, 0.225, 0);
  leg1.material = mat;

  const leg2 = leg1.clone('bench_leg2')!;
  leg2.parent = root;
  leg2.position.set(0.7, 0.225, 0);

    return root;
}

// ─── Haven Park & Plaza ──────────────────────────────────────────────────────

function buildHavenPark(scene: Scene): PrefabResult {
  const meshes: AbstractMesh[] = [];
  const walkable: AbstractMesh[] = [];
  const interactable: AbstractMesh[] = [];

  // Lighting — bright daylight
  const sun = new DirectionalLight('park_sun', new Vector3(-1, -2, -1), scene);
  sun.intensity = 0.9;
  sun.position = new Vector3(20, 30, 20);

  // Ground: large outdoor grass (60m × 60m)
  const grassMat = makeMaterial(scene, 'park_grass', [0.35, 0.62, 0.28]);
  const ground = buildGrassGround(scene, 60, grassMat);
  meshes.push(ground);
  walkable.push(ground);

      // Sidewalk ring around fountain (outer disc as walkable path)
  const pathMat = makeMaterial(scene, 'park_path', [0.45, 0.45, 0.48]);
  const pathRing = MeshBuilder.CreateDisc('park_path_ring', { radius: 4.5 }, scene);
  pathRing.rotation.x = Math.PI / 2;
  pathRing.position.y = 0.01;
  pathRing.material = pathMat;
  pathRing.isPickable = true;
  pathRing.metadata = { walkable: true };
  Tags.AddTagsTo(pathRing, 'walkable');
  meshes.push(pathRing);
  walkable.push(pathRing);

  // Fishing dock extending from south edge
  const dockMat = makeMaterial(scene, 'park_dock', [0.55, 0.42, 0.30]);
  const dockWidth = 2.0;
  const dockLength = 6.0;
  const dock = MeshBuilder.CreateBox('park_dock', { width: dockWidth, depth: dockLength, height: 0.25 }, scene);
  dock.position.set(0, 0.125, -10);
  dock.material = dockMat;
  dock.isPickable = true;
  dock.metadata = { walkable: true, interactable: 'fish' };
  Tags.AddTagsTo(dock, 'walkable interactable fishing_dock');
  meshes.push(dock);
  walkable.push(dock);

  // Fishing dock collision barriers (players can't walk off)
  const barrierMat = makeMaterial(scene, 'park_barrier', [0.7, 0.7, 0.7]);
  const barriers = [
    { x: dockWidth / 2 + 0.5, z: 0 },
    { x: -(dockWidth / 2 + 0.5), z: 0 },
    { x: 0, z: dockLength / 2 + 0.5 },
  ];
  for (const b of barriers) {
    const bar = MeshBuilder.CreateBox('dock_barrier', { width: 1, depth: 0.15, height: 0.6 }, scene);
    bar.position.set(b.x, 0.3, -10 + b.z);
    bar.material = barrierMat;
    bar.isPickable = false;
    bar.metadata = { collision: true };
    Tags.AddTagsTo(bar, 'collision');
    meshes.push(bar);
  }

  // Fishing spot trigger (the actual fish-catching zone)
  const fishTrigger = MeshBuilder.CreateGround('fishing_dock', { width: dockWidth + 1, height: dockLength + 1 }, scene);
  fishTrigger.position.set(0, 0.01, -10);
  fishTrigger.rotation.x = Math.PI / 2;
  fishTrigger.isVisible = false;
  fishTrigger.isPickable = true;
  fishTrigger.metadata = { interactable: 'fish' };
  Tags.AddTagsTo(fishTrigger, 'interactable fishing_dock');
  meshes.push(fishTrigger);
  interactable.push(fishTrigger);

  // Fountain (also a fishing spot for park variety)
  meshes.push(...buildFountain(scene, 0, 0));

  // Park benches
  const benchMat = makeMaterial(scene, 'park_bench_mat', [0.6, 0.55, 0.5]);
  meshes.push(buildBench(scene, -8, 4, 0.3, benchMat));
  meshes.push(buildBench(scene, 8, 4, -0.3, benchMat));
  meshes.push(buildBench(scene, -10, -6, 0.8, benchMat));

  // Trees (decorative — not collidable)
  const treeMat = makeMaterial(scene, 'park_leaf', [0.22, 0.58, 0.32]);
  const trunkMat = makeMaterial(scene, 'park_trunk', [0.55, 0.42, 0.30]);
  const treePositions = [
    { x: -12, z: 8 }, { x: 12, z: 8 }, { x: -14, z: -4 },
    { x: 14, z: -2 }, { x: -8, z: -12 }, { x: 8, z: -12 },
  ];
  for (const tp of treePositions) {
    const trunk = MeshBuilder.CreateCylinder('tree_trunk', { diameter: 0.4, height: 2.2 }, scene);
    trunk.position.set(tp.x, 1.1, tp.z);
    trunk.material = trunkMat;
    meshes.push(trunk);

    const canopy = MeshBuilder.CreateSphere('tree_canopy', { diameter: 2.4, segments: 8 }, scene);
    canopy.position.set(tp.x, 2.6, tp.z);
    canopy.material = treeMat;
    meshes.push(canopy);
  }

    return { meshes, walkableMeshes: walkable, interactableMeshes: interactable };
}

// ─── The Cozy Café ──────────────────────────────────────────────────────────

function buildCafe(scene: Scene): PrefabResult {
  const meshes: AbstractMesh[] = [];
  const walkable: AbstractMesh[] = [];
  const interactable: AbstractMesh[] = [];

    // Indoor lighting — warm, cozy
  const ambientLight = new HemisphericLight('cafe_ambient', new Vector3(0, 1, 0), scene);
  ambientLight.intensity = 0.55;
  ambientLight.specular = new Color3(0.1, 0.1, 0.1);

  const warmLight = new PointLight('cafe_main_light', new Vector3(0, 4.5, 0), scene);
  warmLight.intensity = 0.7;
  warmLight.diffuse = new Color3(1.0, 0.92, 0.78);
  warmLight.specular = new Color3(0.2, 0.18, 0.15);

  // Materials
  const floorMat = makeMaterial(scene, 'cafe_floor', [0.52, 0.42, 0.36]);
  const wallMat = makeMaterial(scene, 'cafe_wall', [0.92, 0.88, 0.84]);
  const woodMat = makeMaterial(scene, 'cafe_wood', [0.55, 0.42, 0.30]);
  const counterMat = makeMaterial(scene, 'cafe_counter', [0.82, 0.78, 0.74]);

  // Floor (18m × 12m café)
  const ground = MeshBuilder.CreateGround('Walkable_CafeFloor', { width: 18, height: 12 }, scene);
  ground.position.y = 0;
  ground.material = floorMat;
    ground.isPickable = true;
  ground.metadata = { walkable: true };
  Tags.AddTagsTo(ground, 'walkable');
  meshes.push(ground);
  walkable.push(ground);

  // Walls (cutaway front for isometric view)
  const wallH = 4.2;
  const wallThick = 0.3;
  const wallL = MeshBuilder.CreateBox('cafe_wall_left', { width: wallThick, depth: 12, height: wallH }, scene);
  wallL.position.set(-9 + wallThick / 2, wallH / 2, 0);
  wallL.material = wallMat;
  meshes.push(wallL);

  const wallR = wallL.clone('cafe_wall_right')!;
  wallR.position.set(9 - wallThick / 2, wallH / 2, 0);
  meshes.push(wallR);

  const wallBack = MeshBuilder.CreateBox('cafe_wall_back', { width: 18, depth: wallThick, height: wallH }, scene);
  wallBack.position.set(0, wallH / 2, -6 + wallThick / 2);
  wallBack.material = wallMat;
  meshes.push(wallBack);

  // Coffee counter (back wall)
  const counter = MeshBuilder.CreateBox('cafe_counter', { width: 12, depth: 1.8, height: 1.0 }, scene);
  counter.position.set(0, 0.5, -5.1);
  counter.material = counterMat;
  counter.isPickable = true;
  counter.metadata = { interactable: 'npc_trade' };
  Tags.AddTagsTo(counter, 'interactable coffee_station');
  meshes.push(counter);
  interactable.push(counter);

  // Counter overhang
  const overhang = MeshBuilder.CreateBox('cafe_counter_overhang', { width: 12, depth: 0.25, height: 1.6 }, scene);
  overhang.position.set(0, 1.55, -4.2);
  overhang.material = woodMat;
  meshes.push(overhang);

  // Espresso machine on counter
  const machine = MeshBuilder.CreateBox('cafe_espresso_machine', { width: 2.2, depth: 0.8, height: 0.8 }, scene);
  machine.position.set(-4, 1.4, -5.0);
  machine.material = makeMaterial(scene, 'cafe_machine', [0.15, 0.15, 0.18]);
  meshes.push(machine);

  // Tables & chairs
  const tablePositions = [
    { x: -3, z: -1 }, { x: 3, z: -1 },
    { x: -5, z: 2 }, { x: 5, z: 2 },
    { x: 0, z: 3.5 },
  ];

  for (let i = 0; i < tablePositions.length; i++) {
    const tp = tablePositions[i];
    const tableTop = MeshBuilder.CreateCylinder(
      `cafe_table_${i}`,
      { diameter: 0.9, height: 0.08, tessellation: 12 },
      scene
    );
    tableTop.position.set(tp.x, 0.75, tp.z);
    tableTop.material = woodMat;
    meshes.push(tableTop);

    const tableLeg = MeshBuilder.CreateCylinder(`cafe_table_leg_${i}`, { diameter: 0.1, height: 0.65 }, scene);
    tableLeg.position.set(tp.x, 0.375, tp.z);
    tableLeg.material = woodMat;
    meshes.push(tableLeg);

    // Two chairs per table
    for (const side of [-1, 1]) {
      const chair = MeshBuilder.CreateBox(`cafe_chair_${i}_${side}`, { width: 0.45, depth: 0.5, height: 0.85 }, scene);
      chair.position.set(tp.x + side * 0.65, 0.425, tp.z + side * 0.55);
      chair.material = woodMat;
      chair.isPickable = true;
      chair.metadata = { interactable: 'sit' };
      Tags.AddTagsTo(chair, 'interactable sit');
      meshes.push(chair);
      interactable.push(chair);
    }
  }

  // Wall-mounted menu board (near entrance)
  const menuBoard = MeshBuilder.CreateBox('cafe_menu_board', { width: 3.2, depth: 0.1, height: 1.8 }, scene);
  menuBoard.position.set(0, 2.8, 5.5);
  menuBoard.material = woodMat;
  meshes.push(menuBoard);

  return { meshes, walkableMeshes: walkable, interactableMeshes: interactable };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const PREFAB_BUILDERS: Record<string, (scene: Scene) => PrefabResult> = {
  'room-park': buildHavenPark,
  'room-cafe': buildCafe,
};

/**
 * Build a procedural room for the given roomId.
 * Returns null if no prefab matches (caller should fall back further).
 */
export function buildRoomPrefab(scene: Scene, roomId: string): AbstractMesh[] | null {
  // Personal lofts — use the existing rich placeholder (already has furniture)
  if (
    roomId.startsWith('room-') &&
    roomId !== 'room-park' &&
    roomId !== 'room-cafe' &&
    roomId !== 'room-town-square' &&
    roomId !== 'room-lobby'
  ) {
    return createPlaceholderRoom(scene);
  }

  const builder = PREFAB_BUILDERS[roomId];
  if (!builder) {
    return null;
  }

  const result = builder(scene);
  // Ensure walkable meshes are tagged so RoomScene shadow-receiver setup works
  for (const m of result.walkableMeshes) {
    m.metadata = { ...(m.metadata || {}), walkable: true };
    if (!Tags.MatchesQuery(m, 'walkable')) {
      Tags.AddTagsTo(m, 'walkable');
    }
  }
  return result.meshes;
}

// Re-export types
export type { PrefabResult };
