import {
  NullEngine,
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Skeleton,
  Bone,
  Animation,
  AnimationGroup,
  MorphTarget,
  MorphTargetManager,
  VertexBuffer,
  TransformNode,
} from '@babylonjs/core';
import { GLTF2Export } from '@babylonjs/serializers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, '../public/assets');
const FURNITURE_DIR = path.join(PUBLIC_DIR, 'furniture');
const ROOMS_DIR = path.join(PUBLIC_DIR, 'rooms');
const AVATARS_DIR = path.join(PUBLIC_DIR, 'avatars');

[FURNITURE_DIR, ROOMS_DIR, AVATARS_DIR].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

async function saveGLB(scene, outPath) {
  const baseName = path.basename(outPath, '.glb');
  const glb = await GLTF2Export.GLBAsync(scene, baseName);
  const blob = glb.glTFFiles[`${baseName}.glb`];
  if (!blob) {
    throw new Error(`GLB export failed for ${outPath}`);
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`[AssetGenerator] Wrote: ${outPath} (${buf.length} bytes)`);
}

// ── 1. FURNITURE GLBs ────────────────────────────────────────────────────────
async function generateFurniture() {
  console.log('[AssetGenerator] Generating furniture GLBs...');

  const furnitureConfigs = {
    chair: {
      color: new Color3(0.55, 0.27, 0.07),
      parts: [
        { name: 'seat', size: { width: 0.5, height: 0.05, depth: 0.5 }, pos: new Vector3(0, 0.45, 0) },
        { name: 'back', size: { width: 0.5, height: 0.3, depth: 0.05 }, pos: new Vector3(0, 0.75, -0.225) },
        { name: 'leg_fl', size: { width: 0.05, height: 0.44, depth: 0.05 }, pos: new Vector3(-0.2, 0.22, 0.2) },
        { name: 'leg_fr', size: { width: 0.05, height: 0.44, depth: 0.05 }, pos: new Vector3(0.2, 0.22, 0.2) },
        { name: 'leg_bl', size: { width: 0.05, height: 0.44, depth: 0.05 }, pos: new Vector3(-0.2, 0.22, -0.2) },
        { name: 'leg_br', size: { width: 0.05, height: 0.44, depth: 0.05 }, pos: new Vector3(0.2, 0.22, -0.2) },
      ],
    },
    table: {
      color: new Color3(0.6, 0.4, 0.2),
      parts: [
        { name: 'top', size: { width: 1.0, height: 0.04, depth: 0.6 }, pos: new Vector3(0, 0.75, 0) },
        { name: 'leg_fl', size: { width: 0.06, height: 0.74, depth: 0.06 }, pos: new Vector3(-0.45, 0.37, 0.25) },
        { name: 'leg_fr', size: { width: 0.06, height: 0.74, depth: 0.06 }, pos: new Vector3(0.45, 0.37, 0.25) },
        { name: 'leg_bl', size: { width: 0.06, height: 0.74, depth: 0.06 }, pos: new Vector3(-0.45, 0.37, -0.25) },
        { name: 'leg_br', size: { width: 0.06, height: 0.74, depth: 0.06 }, pos: new Vector3(0.45, 0.37, -0.25) },
      ],
    },
    sofa: {
      color: new Color3(0.2, 0.4, 0.8),
      parts: [
        { name: 'base', size: { width: 1.8, height: 0.3, depth: 0.8 }, pos: new Vector3(0, 0.25, 0) },
        { name: 'back', size: { width: 1.8, height: 0.3, depth: 0.1 }, pos: new Vector3(0, 0.55, -0.35) },
        { name: 'arm_l', size: { width: 0.1, height: 0.4, depth: 0.8 }, pos: new Vector3(-0.85, 0.45, 0) },
        { name: 'arm_r', size: { width: 0.1, height: 0.4, depth: 0.8 }, pos: new Vector3(0.85, 0.45, 0) },
      ],
    },
    rug: {
      color: new Color3(0.7, 0.15, 0.15),
      parts: [
        { name: 'rug', size: { width: 2.0, height: 0.02, depth: 1.4 }, pos: new Vector3(0, 0.01, 0) },
      ],
    },
    bookshelf: {
      color: new Color3(0.45, 0.22, 0.05),
      parts: [
        { name: 'frame', size: { width: 0.9, height: 1.8, depth: 0.3 }, pos: new Vector3(0, 0.9, 0) },
        { name: 'shelf1', size: { width: 0.88, height: 0.04, depth: 0.28 }, pos: new Vector3(0, 0.35, 0) },
        { name: 'shelf2', size: { width: 0.88, height: 0.04, depth: 0.28 }, pos: new Vector3(0, 0.85, 0) },
        { name: 'shelf3', size: { width: 0.88, height: 0.04, depth: 0.28 }, pos: new Vector3(0, 1.35, 0) },
      ],
    },
    plant: {
      color: new Color3(0.2, 0.65, 0.25),
      parts: [
        { name: 'pot', size: { width: 0.35, height: 0.35, depth: 0.35 }, pos: new Vector3(0, 0.175, 0) },
        { name: 'stem', size: { width: 0.08, height: 0.4, depth: 0.08 }, pos: new Vector3(0, 0.45, 0) },
        { name: 'leaves', size: { width: 0.5, height: 0.4, depth: 0.5 }, pos: new Vector3(0, 0.75, 0) },
      ],
    },
  };

  for (const [name, config] of Object.entries(furnitureConfigs)) {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mat = new StandardMaterial(`mat_${name}`, scene);
    mat.diffuseColor = config.color;

    const meshes = [];
    for (const part of config.parts) {
      const box = MeshBuilder.CreateBox(`${name}_${part.name}`, part.size, scene);
      box.position.copyFrom(part.pos);
      box.material = mat;
      meshes.push(box);
    }

    const merged = MeshBuilder.CreateBox(name, { size: 0.001 }, scene);
    merged.isVisible = false;
    meshes.forEach((m) => (m.parent = merged));

    await saveGLB(scene, path.join(FURNITURE_DIR, `${name}.glb`));
    await saveGLB(scene, path.join(FURNITURE_DIR, `furniture-${name}.glb`));
    engine.dispose();
  }

  // Lamp (cylinder pieces)
  {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mat = new StandardMaterial('mat_lamp', scene);
    mat.diffuseColor = new Color3(0.85, 0.85, 0.75);

    const base = MeshBuilder.CreateCylinder('lamp_base', { diameter: 0.36, height: 0.08 }, scene);
    base.position.y = 0.04;
    base.material = mat;

    const pole = MeshBuilder.CreateCylinder('lamp_pole', { diameter: 0.08, height: 1.5 }, scene);
    pole.position.y = 0.75;
    pole.material = mat;

    const shade = MeshBuilder.CreateCylinder('lamp_shade', { diameterTop: 0.3, diameterBottom: 0.5, height: 0.35 }, scene);
    shade.position.y = 1.55;
    shade.material = mat;

    const root = MeshBuilder.CreateBox('lamp', { size: 0.001 }, scene);
    root.isVisible = false;
    base.parent = root;
    pole.parent = root;
    shade.parent = root;

    await saveGLB(scene, path.join(FURNITURE_DIR, 'lamp.glb'));
    await saveGLB(scene, path.join(FURNITURE_DIR, 'furniture-lamp.glb'));
    engine.dispose();
  }
}

// ── 2. ROOM GLB (Town Square) ────────────────────────────────────────────────
async function generateTownSquare() {
  console.log('[AssetGenerator] Generating town_square.glb...');
  const engine = new NullEngine();
  const scene = new Scene(engine);

  const matFloor = new StandardMaterial('mat_floor', scene);
  matFloor.diffuseColor = new Color3(0.35, 0.38, 0.42);

  const matWall = new StandardMaterial('mat_wall', scene);
  matWall.diffuseColor = new Color3(0.25, 0.28, 0.32);

  const matProp = new StandardMaterial('mat_prop', scene);
  matProp.diffuseColor = new Color3(0.5, 0.45, 0.4);

  // Walkable Floor
  const floor = MeshBuilder.CreateGround('walkable_floor', { width: 20, height: 20 }, scene);
  floor.material = matFloor;
  floor.metadata = { walkable: true };

  // NavMesh Floor (invisible collision / path finding plane)
  const navMesh = MeshBuilder.CreateGround('navmesh_floor', { width: 20, height: 20 }, scene);
  navMesh.position.y = 0.001;
  navMesh.isVisible = false;
  navMesh.metadata = { walkable: true };

  // Walls
  const wallN = MeshBuilder.CreateBox('wall_north', { width: 20, height: 4, depth: 0.4 }, scene);
  wallN.position.set(0, 2, 10);
  wallN.material = matWall;

  const wallS = MeshBuilder.CreateBox('wall_south', { width: 20, height: 4, depth: 0.4 }, scene);
  wallS.position.set(0, 2, -10);
  wallS.material = matWall;

  const wallE = MeshBuilder.CreateBox('wall_east', { width: 0.4, height: 4, depth: 20 }, scene);
  wallE.position.set(10, 2, 0);
  wallE.material = matWall;

  const wallW = MeshBuilder.CreateBox('wall_west', { width: 0.4, height: 4, depth: 20 }, scene);
  wallW.position.set(-10, 2, 0);
  wallW.material = matWall;

  // Props
  const bench = MeshBuilder.CreateBox('prop_bench_01', { width: 1.5, height: 0.45, depth: 0.4 }, scene);
  bench.position.set(5, 0.225, 5);
  bench.material = matProp;

  const fountain = MeshBuilder.CreateCylinder('prop_fountain', { diameter: 3, height: 0.6 }, scene);
  fountain.position.set(0, 0.3, 0);
  fountain.material = matProp;

  await saveGLB(scene, path.join(ROOMS_DIR, 'town_square.glb'));
  engine.dispose();
}

// ── 3. RIGGED AVATAR GLB (base_avatar.glb) ──────────────────────────────────
async function generateBaseAvatar() {
  console.log('[AssetGenerator] Generating base_avatar.glb with skeleton, morph targets, and animations...');
  const engine = new NullEngine();
  const scene = new Scene(engine);

  // Materials
  const matSkin = new StandardMaterial('mat_skin', scene);
  matSkin.diffuseColor = Color3.FromHexString('#F5CBA7');

  const matHair = new StandardMaterial('mat_hair', scene);
  matHair.diffuseColor = Color3.FromHexString('#1C1C1C');

  const matEyes = new StandardMaterial('mat_eyes', scene);
  matEyes.diffuseColor = Color3.FromHexString('#4A3728');

  const matShirt = new StandardMaterial('mat_shirt', scene);
  matShirt.diffuseColor = Color3.FromHexString('#4169E1');

  const matPants = new StandardMaterial('mat_pants', scene);
  matPants.diffuseColor = Color3.FromHexString('#2E8B57');

  // Skeleton / Armature with linked TransformNodes
  const skeleton = new Skeleton('Armature', 'armature_id', scene);
  const armatureRootNode = new TransformNode('Armature', scene);

  function createBone(name, parentBone, parentNode, pos) {
    const node = new TransformNode(name, scene);
    node.parent = parentNode;
    node.position.copyFrom(pos);
    const bone = new Bone(name, skeleton, parentBone, null);
    bone.linkTransformNode(node);
    return { bone, node };
  }

  const root = createBone('Root', null, armatureRootNode, new Vector3(0, 0, 0));
  const hips = createBone('Hips', root.bone, root.node, new Vector3(0, 0.9, 0));
  const spine = createBone('Spine', hips.bone, hips.node, new Vector3(0, 0.25, 0));
  const spine1 = createBone('Spine1', spine.bone, spine.node, new Vector3(0, 0.25, 0));
  const spine2 = createBone('Spine2', spine1.bone, spine1.node, new Vector3(0, 0.2, 0));
  const neck = createBone('Neck', spine2.bone, spine2.node, new Vector3(0, 0.15, 0));
  const headBone = createBone('Head', neck.bone, neck.node, new Vector3(0, 0.2, 0));

  // Left Arm
  const leftArm = createBone('LeftArm', spine2.bone, spine2.node, new Vector3(-0.35, 0.1, 0));
  const leftHand = createBone('LeftHand', leftArm.bone, leftArm.node, new Vector3(-0.3, -0.3, 0));

  // Right Arm
  const rightArm = createBone('RightArm', spine2.bone, spine2.node, new Vector3(0.35, 0.1, 0));
  const rightHand = createBone('RightHand', rightArm.bone, rightArm.node, new Vector3(0.3, -0.3, 0));

  // Left Leg
  const leftLeg = createBone('LeftLeg', hips.bone, hips.node, new Vector3(-0.18, -0.4, 0));
  const leftFoot = createBone('LeftFoot', leftLeg.bone, leftLeg.node, new Vector3(0, -0.45, 0));

  // Right Leg
  const rightLeg = createBone('RightLeg', hips.bone, hips.node, new Vector3(0.18, -0.4, 0));
  const rightFoot = createBone('RightFoot', rightLeg.bone, rightLeg.node, new Vector3(0, -0.45, 0));

  // Main Body Mesh (Torso)
  const body = MeshBuilder.CreateBox('Body', { width: 0.45, height: 0.65, depth: 0.25 }, scene);
  body.position.set(0, 1.25, 0);
  body.material = matShirt;

  // Head Mesh
  const head = MeshBuilder.CreateSphere('avatar_head', { diameter: 0.38, segments: 12 }, scene);
  head.position.set(0, 1.8, 0);
  head.material = matSkin;
  head.parent = body;

  // Hair Mesh
  const hair = MeshBuilder.CreateSphere('avatar_hair', { diameter: 0.4, segments: 10 }, scene);
  hair.position.set(0, 1.85, -0.03);
  hair.scaling.set(1.02, 0.8, 1.05);
  hair.material = matHair;
  hair.parent = body;

  // Eyes
  const eyeL = MeshBuilder.CreateSphere('eye_l', { diameter: 0.07 }, scene);
  eyeL.position.set(-0.08, 1.82, 0.16);
  eyeL.material = matEyes;
  eyeL.parent = body;

  const eyeR = MeshBuilder.CreateSphere('eye_r', { diameter: 0.07 }, scene);
  eyeR.position.set(0.08, 1.82, 0.16);
  eyeR.material = matEyes;
  eyeR.parent = body;

  // Legs (Pants)
  const legL = MeshBuilder.CreateCylinder('leg_left', { diameter: 0.14, height: 0.75 }, scene);
  legL.position.set(-0.14, 0.45, 0);
  legL.material = matPants;
  legL.parent = body;

  const legR = MeshBuilder.CreateCylinder('leg_right', { diameter: 0.14, height: 0.75 }, scene);
  legR.position.set(0.14, 0.45, 0);
  legR.material = matPants;
  legR.parent = body;

  // Attach skeleton to body
  body.skeleton = skeleton;

  // Morph Targets on Body
  const morphManager = new MorphTargetManager();
  body.morphTargetManager = morphManager;

  const positions = body.getVerticesData(VertexBuffer.PositionKind);
  if (positions) {
    const basis = MorphTarget.FromMesh(body, 'Basis', 0);
    morphManager.addTarget(basis);

    const morphNames = ['fat', 'thin', 'tall', 'short', 'muscular'];
    for (const mName of morphNames) {
      const morphPositions = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        let x = positions[i];
        let y = positions[i + 1];
        let z = positions[i + 2];

        if (mName === 'fat') {
          x *= 1.35;
          z *= 1.4;
        } else if (mName === 'thin') {
          x *= 0.75;
          z *= 0.75;
        } else if (mName === 'tall') {
          y *= 1.25;
        } else if (mName === 'short') {
          y *= 0.8;
        } else if (mName === 'muscular') {
          x *= 1.25;
          z *= 1.15;
        }
        morphPositions[i] = x;
        morphPositions[i + 1] = y;
        morphPositions[i + 2] = z;
      }
      const target = new MorphTarget(mName, 0);
      target.setPositions(morphPositions);
      morphManager.addTarget(target);
    }
  }

  // ── Animation Groups ─────────────────────────────────────────────────────
  const animNames = ['idle', 'walk', 'sit', 'wave', 'dance'];
  for (const animName of animNames) {
    const ag = new AnimationGroup(animName, scene);

    const bodyAnim = new Animation(
      `anim_${animName}`,
      'position.y',
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );

    let keys = [];
    if (animName === 'idle') {
      keys = [
        { frame: 0, value: 1.25 },
        { frame: 15, value: 1.27 },
        { frame: 30, value: 1.25 },
      ];
    } else if (animName === 'walk') {
      keys = [
        { frame: 0, value: 1.25 },
        { frame: 7, value: 1.28 },
        { frame: 15, value: 1.25 },
        { frame: 22, value: 1.28 },
        { frame: 30, value: 1.25 },
      ];
    } else if (animName === 'sit') {
      keys = [
        { frame: 0, value: 0.8 },
        { frame: 30, value: 0.8 },
      ];
    } else if (animName === 'wave') {
      keys = [
        { frame: 0, value: 1.25 },
        { frame: 10, value: 1.26 },
        { frame: 20, value: 1.24 },
        { frame: 30, value: 1.25 },
      ];
    } else if (animName === 'dance') {
      keys = [
        { frame: 0, value: 1.22 },
        { frame: 15, value: 1.30 },
        { frame: 30, value: 1.22 },
      ];
    }

    bodyAnim.setKeys(keys);
    ag.addTargetedAnimation(bodyAnim, body);
  }

  await saveGLB(scene, path.join(AVATARS_DIR, 'base_avatar.glb'));
  engine.dispose();
}

async function run() {
  await generateFurniture();
  await generateTownSquare();
  await generateBaseAvatar();
  console.log('[AssetGenerator] All Part 5B 3D assets generated successfully!');
}

run().catch((err) => {
  console.error('[AssetGenerator] Fatal error:', err);
  process.exit(1);
});
