import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Tags } from '@babylonjs/core/Misc/tags';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HeadlessRoomScene } from '../../src/game/roomScene';

describe('Headless RoomScene (Babylon.js NullEngine)', () => {
  let engine: NullEngine;
  let roomScene: HeadlessRoomScene;

  beforeEach(() => {
    engine = new NullEngine();
    roomScene = new HeadlessRoomScene(engine, { fogDensity: 0.03, groundSize: 40 });
  });

  afterEach(() => {
    roomScene.dispose();
    engine.dispose();
  });

  it('(a) NullEngine instantiates and renders scene without WebGL context', () => {
    expect(roomScene.scene).toBeDefined();
    expect(engine).toBeInstanceOf(NullEngine);

    // Render a frame in headless mode without crashing
    expect(() => roomScene.render()).not.toThrow();
  });

  it('(b) Camera positioned at default isometric offset (radius ~10, beta ~0.95 rad)', () => {
    const cam = roomScene.camera;
    expect(cam).toBeDefined();
    expect(cam.radius).toBeCloseTo(10, 1);
    expect(cam.beta).toBeCloseTo(0.95, 2);
    expect(cam.alpha).toBeCloseTo(-Math.PI / 4, 2);
  });

  it('(c) Lighting setup: HemisphericLight + DirectionalLight with correct intensities', () => {
    const ambient = roomScene.ambientLight;
    const sun = roomScene.sunLight;

    expect(ambient).toBeDefined();
    expect(ambient.intensity).toBeCloseTo(0.75, 2);

    expect(sun).toBeDefined();
    expect(sun.intensity).toBeCloseTo(1.1, 2);
    expect(sun.direction.y).toBeLessThan(0); // pointing downwards
  });

  it('(d) Mood lighting transitions: morning, afternoon, evening, night presets update light colors', () => {
    // Morning: warm golden/yellow
    roomScene.setMood('morning');
    expect(roomScene.ambientLight.diffuse.r).toBeGreaterThan(0.9);
    expect(roomScene.ambientLight.diffuse.b).toBeLessThan(0.85);

    // Afternoon: bright neutral white
    roomScene.setMood('afternoon');
    expect(roomScene.ambientLight.diffuse.r).toBeCloseTo(1.0, 1);
    expect(roomScene.ambientLight.diffuse.g).toBeCloseTo(1.0, 1);
    expect(roomScene.ambientLight.diffuse.b).toBeCloseTo(1.0, 1);

    // Evening: dusk purple/pink
    roomScene.setMood('evening');
    expect(roomScene.ambientLight.diffuse.r).toBeGreaterThan(roomScene.ambientLight.diffuse.g);

    // Night: deep cool navy blue
    roomScene.setMood('night');
    expect(roomScene.ambientLight.diffuse.b).toBeGreaterThan(roomScene.ambientLight.diffuse.r);
  });

  it('(e) Fog configuration: mode = FOGMODE_EXP2, density adjusted by room config', () => {
    expect(roomScene.scene.fogMode).toBe(Scene.FOGMODE_EXP2);
    expect(roomScene.scene.fogDensity).toBeCloseTo(0.03, 3);
  });

  it('(f) Ground plane with collision / physics impostor flags', () => {
    const ground = roomScene.ground;
    expect(ground).toBeDefined();
    expect(ground.checkCollisions).toBe(true);
    expect(ground.isPickable).toBe(true);
    expect(Tags.MatchesQuery(ground, 'walkable')).toBe(true);
  });

  it('(g) NavMesh generation or loading attaches to room scene', () => {
    const navMesh = MeshBuilder.CreateGround('navMesh_test', { width: 30, height: 30 }, roomScene.scene);
    roomScene.attachNavMesh(navMesh);

    expect(roomScene.navMesh).toBe(navMesh);
    expect(navMesh.isVisible).toBe(false);
    expect(Tags.MatchesQuery(navMesh, 'navmesh')).toBe(true);
  });

  it('(h) Pet NPC entity spawned with wandering state machine', () => {
    const pet = roomScene.spawnPet(new Vector3(0, 0, 0));

    expect(pet).toBeDefined();
    expect(pet.state).toBe('idle');

    // Simulate tick advancing state past 1000ms -> transitions to 'walking'
    pet.update(1200);
    expect(pet.state).toBe('walking');
    expect(pet.targetPos).not.toBeNull();

    // Advance walking state
    pet.update(500);
    expect(pet.state).toBe('walking');

    // Timeout walking state -> returns to 'idle'
    pet.update(2100);
    expect(pet.state).toBe('idle');
  });

  it('(i) Clean disposal: scene.dispose() leaves no lingering observers or meshes', () => {
    roomScene.spawnPet();
    const scene = roomScene.scene;
    expect(scene.meshes.length).toBeGreaterThan(0);

    roomScene.dispose();

    expect(scene.isDisposed).toBe(true);
    expect(scene.meshes.length).toBe(0);
  });
});
