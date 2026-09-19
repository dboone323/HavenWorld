import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Tags,
  PointLight,
  AbstractMesh,
} from '@babylonjs/core';

/**
 * Creates a cozy MegaPlanet / YoWorld styled isometric cutaway room.
 * - 14m × 14m apartment loft dimensions
 * - Back-Left and Back-Right walls with baseboards and architectural depth
 * - Interior Exit Door on back-left wall
 * - Open front cutaways for unobstructed isometric viewing
 * - Warm soft carpet floor and starter furniture
 */
export function createPlaceholderRoom(scene: Scene): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];
  const roomHalf = 7; // 14m x 14m room

  // ─── MATERIALS ────────────────────────────────────────────────────────────
  // Warm Scandinavian oak hardwood floor (YoWorld / MegaPlanet warmth)
  const floorMat = new StandardMaterial('floor_mat', scene);
  floorMat.diffuseColor = new Color3(0.76, 0.62, 0.48); // Warm honey oak
  floorMat.specularColor = new Color3(0.08, 0.08, 0.08);

  // Modern clean studio wall plaster
  const wallMat = new StandardMaterial('wall_mat', scene);
  wallMat.diffuseColor = new Color3(0.95, 0.95, 0.97); // Crisp clean studio walls
  wallMat.specularColor = new Color3(0.02, 0.02, 0.02);

  // Crisp white trim & baseboard
  const trimMat = new StandardMaterial('trim_mat', scene);
  trimMat.diffuseColor = new Color3(0.98, 0.98, 0.98);
  trimMat.specularColor = new Color3(0.1, 0.1, 0.1);

  // Warm wood for door & tables
  const woodMat = new StandardMaterial('wood_mat', scene);
  woodMat.diffuseColor = new Color3(0.65, 0.48, 0.35);
  woodMat.specularColor = new Color3(0.08, 0.08, 0.08);

  // Metallic door handle
  const metalMat = new StandardMaterial('metal_mat', scene);
  metalMat.diffuseColor = new Color3(0.85, 0.85, 0.85);
  metalMat.specularColor = new Color3(0.6, 0.6, 0.6);

  // Cozy furniture fabrics
  const sofaMat = new StandardMaterial('sofa_mat', scene);
  sofaMat.diffuseColor = new Color3(0.55, 0.60, 0.72); // Modern periwinkle/slate blue
  sofaMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const cushionMat = new StandardMaterial('cushion_mat', scene);
  cushionMat.diffuseColor = new Color3(0.70, 0.82, 0.88); // Soft sky blue accent

  const rugMat = new StandardMaterial('rug_mat', scene);
  rugMat.diffuseColor = new Color3(0.85, 0.83, 0.78); // Textured oatmeal rug
  rugMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const tvMat = new StandardMaterial('tv_mat', scene);
  tvMat.diffuseColor = new Color3(0.12, 0.14, 0.18); // Dark charcoal screen

  const plantMat = new StandardMaterial('plant_mat', scene);
  plantMat.diffuseColor = new Color3(0.22, 0.58, 0.32); // Fresh monstera green

  const potMat = new StandardMaterial('pot_mat', scene);
  potMat.diffuseColor = new Color3(0.88, 0.84, 0.80);

  // ─── FLOOR ────────────────────────────────────────────────────────────────
  const floor = MeshBuilder.CreateBox(
    'Floor',
    { width: roomHalf * 2, depth: roomHalf * 2, height: 0.3 },
    scene
  );
  floor.position.set(0, -0.15, 0);
  floor.material = floorMat;
  floor.isPickable = true;
  floor.metadata = { walkable: true };
  Tags.AddTagsTo(floor, 'walkable');
  meshes.push(floor);

  // Clean front-edge architectural lip
  const lipFront1 = MeshBuilder.CreateBox('lip_front1', { width: 0.08, depth: roomHalf * 2, height: 0.34 }, scene);
  lipFront1.position.set(roomHalf + 0.04, -0.13, 0);
  lipFront1.material = trimMat;
  meshes.push(lipFront1);

  const lipFront2 = MeshBuilder.CreateBox('lip_front2', { width: roomHalf * 2, depth: 0.08, height: 0.34 }, scene);
  lipFront2.position.set(0, -0.13, -roomHalf - 0.04);
  lipFront2.material = trimMat;
  meshes.push(lipFront2);

  // ─── CUTAWAY WALLS ────────────────────────────────────────────────────────
  const wallH = 4.8;
  const wallThick = 0.35;

  // Back-Left Wall (along X = -roomHalf)
  const wallLeft = MeshBuilder.CreateBox(
    'wall_back_left',
    { width: wallThick, depth: roomHalf * 2, height: wallH },
    scene
  );
  wallLeft.position.set(-roomHalf - wallThick / 2, wallH / 2, 0);
  wallLeft.material = wallMat;
  wallLeft.isPickable = false;
  meshes.push(wallLeft);

  // Back-Right Wall (along Z = +roomHalf)
  const wallRight = MeshBuilder.CreateBox(
    'wall_back_right',
    { width: roomHalf * 2 + wallThick, depth: wallThick, height: wallH },
    scene
  );
  wallRight.position.set(-wallThick / 2, wallH / 2, roomHalf + wallThick / 2);
  wallRight.material = wallMat;
  wallRight.isPickable = false;
  meshes.push(wallRight);

  // ─── BASEBOARDS / SKIRTING ───────────────────────────────────────────────
  const baseH = 0.28;
  const baseThick = 0.08;

  const baseLeft = MeshBuilder.CreateBox('base_left', { width: baseThick, depth: roomHalf * 2, height: baseH }, scene);
  baseLeft.position.set(-roomHalf + baseThick / 2, baseH / 2, 0);
  baseLeft.material = trimMat;
  meshes.push(baseLeft);

  const baseRight = MeshBuilder.CreateBox('base_right', { width: roomHalf * 2, depth: baseThick, height: baseH }, scene);
  baseRight.position.set(0, baseH / 2, roomHalf - baseThick / 2);
  baseRight.material = trimMat;
  meshes.push(baseRight);

  // ─── ROOM EXIT DOOR (on Back-Left Wall) ───────────────────────────────────
  // Door frame (white casing)
  const doorFrame = MeshBuilder.CreateBox('door_frame', { width: 0.12, depth: 1.6, height: 2.8 }, scene);
  doorFrame.position.set(-roomHalf + 0.06, 1.4, -3.2);
  doorFrame.material = trimMat;
  meshes.push(doorFrame);

  // Door slab (interior paneled white door)
  const doorSlab = MeshBuilder.CreateBox('door_portal', { width: 0.08, depth: 1.4, height: 2.65 }, scene);
  doorSlab.position.set(-roomHalf + 0.09, 1.35, -3.2);
  doorSlab.material = trimMat;
  doorSlab.isPickable = true;
  Tags.AddTagsTo(doorSlab, 'door_exit');
  meshes.push(doorSlab);

  // Door handle (metallic lever)
  const doorHandle = MeshBuilder.CreateCylinder('door_handle', { diameter: 0.06, height: 0.14 }, scene);
  doorHandle.rotation.z = Math.PI / 2;
  doorHandle.position.set(-roomHalf + 0.16, 1.25, -2.7);
  doorHandle.material = metalMat;
  meshes.push(doorHandle);

  // ─── STARTER APARTMENT FURNITURE ──────────────────────────────────────────
  // 1. Cozy Area Rug in living area
  const rug = MeshBuilder.CreateGround('starter_rug', { width: 5.6, height: 4.8 }, scene);
  rug.position.set(-1.2, 0.015, 3.6);
  rug.material = rugMat;
  rug.isPickable = true;
  rug.metadata = { walkable: true };
  Tags.AddTagsTo(rug, 'walkable');
  meshes.push(rug);

  // 2. Modern 3-Seat Sofa (along back-right wall)
  const sofaBase = MeshBuilder.CreateBox('sofa_base', { width: 3.6, depth: 1.4, height: 0.45 }, scene);
  sofaBase.position.set(-1.2, 0.23, 5.8);
  sofaBase.material = sofaMat;
  sofaBase.isPickable = true;
  sofaBase.metadata = { interactable: 'sit' };
  Tags.AddTagsTo(sofaBase, 'interactable sit');
  meshes.push(sofaBase);

  const sofaBack = MeshBuilder.CreateBox('sofa_back', { width: 3.6, depth: 0.35, height: 0.75 }, scene);
  sofaBack.position.set(-1.2, 0.65, 6.35);
  sofaBack.material = sofaMat;
  meshes.push(sofaBack);

  const sofaArmL = MeshBuilder.CreateBox('sofa_arm_l', { width: 0.3, depth: 1.4, height: 0.65 }, scene);
  sofaArmL.position.set(-2.85, 0.48, 5.8);
  sofaArmL.material = sofaMat;
  meshes.push(sofaArmL);

  const sofaArmR = MeshBuilder.CreateBox('sofa_arm_r', { width: 0.3, depth: 1.4, height: 0.65 }, scene);
  sofaArmR.position.set(0.45, 0.48, 5.8);
  sofaArmR.material = sofaMat;
  meshes.push(sofaArmR);

  // Pillows on sofa
  const pillow1 = MeshBuilder.CreateBox('pillow_1', { width: 0.45, depth: 0.25, height: 0.45 }, scene);
  pillow1.position.set(-2.45, 0.62, 5.95);
  pillow1.rotation.y = 0.2;
  pillow1.material = cushionMat;
  meshes.push(pillow1);

  const pillow2 = MeshBuilder.CreateBox('pillow_2', { width: 0.45, depth: 0.25, height: 0.45 }, scene);
  pillow2.position.set(0.05, 0.62, 5.95);
  pillow2.rotation.y = -0.2;
  pillow2.material = cushionMat;
  meshes.push(pillow2);

  // 3. Wooden Coffee Table in front of sofa
  const coffeeTable = MeshBuilder.CreateBox('coffee_table', { width: 2.0, depth: 1.0, height: 0.42 }, scene);
  coffeeTable.position.set(-1.2, 0.21, 4.0);
  coffeeTable.material = woodMat;
  meshes.push(coffeeTable);

  // 4. Media Console & TV (along back-left wall)
  const mediaConsole = MeshBuilder.CreateBox('media_console', { width: 0.9, depth: 2.8, height: 0.55 }, scene);
  mediaConsole.position.set(-6.15, 0.28, 0.8);
  mediaConsole.material = woodMat;
  meshes.push(mediaConsole);

  const tvScreen = MeshBuilder.CreateBox('tv_screen', { width: 0.12, depth: 2.2, height: 1.3 }, scene);
  tvScreen.position.set(-6.15, 1.25, 0.8);
  tvScreen.material = tvMat;
  meshes.push(tvScreen);

  const tvStand = MeshBuilder.CreateBox('tv_stand', { width: 0.4, depth: 0.8, height: 0.08 }, scene);
  tvStand.position.set(-6.15, 0.6, 0.8);
  tvStand.material = metalMat;
  meshes.push(tvStand);

  // 5. Potted Monstera Houseplant (in corner)
  const pot = MeshBuilder.CreateCylinder('corner_pot', { diameter: 0.7, height: 0.75 }, scene);
  pot.position.set(-5.8, 0.38, 5.8);
  pot.material = potMat;
  meshes.push(pot);

  const foliage = MeshBuilder.CreateSphere('corner_foliage', { diameterX: 1.2, diameterY: 1.4, diameterZ: 1.2 }, scene);
  foliage.position.set(-5.8, 1.25, 5.8);
  foliage.material = plantMat;
  meshes.push(foliage);

  // ─── AMBIENT LIGHTING ─────────────────────────────────────────────────────
  const roomLight = new PointLight('room_light', new Vector3(0, 4.5, 0), scene);
  roomLight.intensity = 0.45;
  roomLight.diffuse = new Color3(1.0, 0.96, 0.92); // Warm light

  console.log('[PlaceholderRoom] Created MegaPlanet-style isometric cutaway loft.');
  return meshes;
}
