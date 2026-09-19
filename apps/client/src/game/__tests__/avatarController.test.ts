import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager';
import { MorphTarget } from '@babylonjs/core/Morph/morphTarget';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AvatarController } from '../avatarController';

describe('AvatarController (Babylon.js NullEngine)', () => {
  let engine: NullEngine;
  let scene: Scene;
  let controller: AvatarController;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    controller = new AvatarController(scene, {
      id: 'test-user-1',
      username: 'TestAvatar',
      avatarData: {
        bodyType: 0.5,
        skinColor: '#FFE0BD',
        hairColor: '#332211',
      },
    });
  });

  afterEach(() => {
    controller.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('(a) init(spawnPos) creates root mesh at spawnPos', async () => {
    const spawnPos = new Vector3(5, 0, 10);
    await controller.init(spawnPos);

    expect(controller.rootMesh).not.toBeNull();
    expect(controller.position.x).toBeCloseTo(5);
    expect(controller.position.z).toBeCloseTo(10);
  });

  it('(b) moveTo(target) sets moving state and calculates rotation toward target', async () => {
    await controller.init(new Vector3(0, 0, 0));
    const target = new Vector3(10, 0, 0);

    controller.moveTo(target);

    expect(controller.isMoving).toBe(true);
    expect(controller.targetPosition).not.toBeNull();
    expect(controller.targetPosition?.x).toBe(10);
    // Rotating towards +X (x=10, z=0): Math.atan2(10, 0) = PI / 2
    expect(controller.rootMesh?.rotation.y).toBeCloseTo(Math.PI / 2, 2);
  });

  it('(c) Movement update loop advances position toward target each tick', async () => {
    await controller.init(new Vector3(0, 0, 0));
    controller.moveTo(new Vector3(10, 0, 0));

    const initialX = controller.position.x;
    controller.updateMovement();
    const advancedX = controller.position.x;

    expect(advancedX).toBeGreaterThan(initialX);
    expect(controller.isMoving).toBe(true);
  });

  it('(d) Arrival at target (within threshold) stops movement, snaps to target, transitions to idle', async () => {
    await controller.init(new Vector3(9.9, 0, 0));
    controller.moveTo(new Vector3(10, 0, 0));

    // Update with distance 0.1m, which is within the 0.15m arrival threshold
    controller.updateMovement();

    expect(controller.isMoving).toBe(false);
    expect(controller.position.x).toBe(10);
    expect(controller.targetPosition).toBeNull();
    expect(controller.currentAnimName).toBe('idle');
  });

  it('(e) playSocialAnim("wave") triggers cross-fade, non-looping', async () => {
    await controller.init(new Vector3(0, 0, 0));

    controller.playSocialAnim('wave');

    expect(controller.isMoving).toBe(false);
    expect(controller.targetPosition).toBeNull();
    expect(controller.currentAnimName).toBe('wave');
  });

  it('(f) applyCustomization({ skinColor, hairColor, ... }) updates material colors', async () => {
    await controller.init(new Vector3(0, 0, 0));

    // Create a hair material in the scene to test material updates
    const hairMat = new StandardMaterial('mat_hair', scene);
    hairMat.diffuseColor = new Color3(0, 0, 0);

    controller.applyCustomization({
      skinColor: '#FFCC99',
      hairColor: '#FF0000',
    });

    const expectedRed = Color3.FromHexString('#FF0000');
    expect(hairMat.diffuseColor.r).toBeCloseTo(expectedRed.r, 2);
    expect(hairMat.diffuseColor.g).toBeCloseTo(expectedRed.g, 2);
    expect(hairMat.diffuseColor.b).toBeCloseTo(expectedRed.b, 2);
  });

  it('(g) Morph target influences applied based on body dimensions (fat, thin, tall, short, muscular)', async () => {
    await controller.init(new Vector3(0, 0, 0));

    const morphManager = new MorphTargetManager(scene);
    const fatTarget = new MorphTarget('fat', 0, scene);
    const thinTarget = new MorphTarget('thin', 0, scene);
    const tallTarget = new MorphTarget('tall', 0, scene);
    const muscularTarget = new MorphTarget('muscular', 0, scene);

    morphManager.addTarget(fatTarget);
    morphManager.addTarget(thinTarget);
    morphManager.addTarget(tallTarget);
    morphManager.addTarget(muscularTarget);

    controller.addMorphTargetManager(morphManager);

    // Apply bodyType = 0.9 (fat > 0), height = 0.8 (tall > 0), build = 0.75 (muscular > 0)
    controller.applyMorphTargets({
      bodyType: 0.9,
      height: 0.8,
      build: 0.75,
    });

    expect(fatTarget.influence).toBeCloseTo((0.9 - 0.5) * 2, 2);
    expect(thinTarget.influence).toBe(0);
    expect(tallTarget.influence).toBeCloseTo((0.8 - 0.5) * 2, 2);
    expect(muscularTarget.influence).toBeCloseTo(0.75, 2);
  });

  it('(h) dispose() unregisters render observer, disposes meshes and textures', async () => {
    await controller.init(new Vector3(0, 0, 0));
    expect(controller.rootMesh).not.toBeNull();

    controller.dispose();

    expect(controller.rootMesh).toBeNull();
  });

  it('(i) applyOutfit builds enabled wardrobe layers tinted with the equipped item colours', async () => {
    await controller.init(new Vector3(0, 0, 0));

    controller.applyOutfit({
      gender: 'female',
      hairStyle: 'hair-long-01',
      hairColor: '#5C3317',
      outfitBody: 'shirt-blue',
      outfitLegs: 'pants-black',
      outfitFeet: 'shoes-white',
    });

    const meshColor = (name: string): string => {
      const mesh = scene.getMeshByName(name) as Mesh;
      expect(mesh, `${name} should exist`).not.toBeNull();
      expect(mesh.isEnabled()).toBe(true);
      return (mesh.material as StandardMaterial).diffuseColor.toHexString().toLowerCase();
    };

    expect(meshColor('avatar_test-user-1_hair')).toBe('#5c3317');
    expect(meshColor('avatar_test-user-1_top')).toBe('#4169e1');
    expect(meshColor('avatar_test-user-1_pants')).toBe('#1c1c1c');
    expect(meshColor('avatar_test-user-1_shoe_l')).toBe('#f5f5f5');
    expect(meshColor('avatar_test-user-1_shoe_r')).toBe('#f5f5f5');
  });

  it('(j) applyOutfit hides unequipped layers and shapes male/female proportions differently', async () => {
    await controller.init(new Vector3(0, 0, 0));

    controller.applyOutfit({ gender: 'unspecified' });
    const unequippedTop = scene.getMeshByName('avatar_test-user-1_top') as Mesh;
    expect(unequippedTop.isEnabled()).toBe(false);

    controller.applyOutfit({
      gender: 'male',
      outfitBody: 'shirt-black',
      outfitLegs: 'pants-blue',
    });
    const maleTop = scene.getMeshByName('avatar_test-user-1_top') as Mesh;
    const malePants = scene.getMeshByName('avatar_test-user-1_pants') as Mesh;
    expect(maleTop.isEnabled()).toBe(true);
    expect(maleTop.scaling.x).toBeGreaterThan(malePants.scaling.x);

    controller.applyOutfit({
      gender: 'female',
      outfitBody: 'shirt-black',
      outfitLegs: 'pants-blue',
    });
    const femaleTop = scene.getMeshByName('avatar_test-user-1_top') as Mesh;
    const femalePants = scene.getMeshByName('avatar_test-user-1_pants') as Mesh;
    expect(femalePants.scaling.x).toBeGreaterThan(femaleTop.scaling.x);
  });
});
