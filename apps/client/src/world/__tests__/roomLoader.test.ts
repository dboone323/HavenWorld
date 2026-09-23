import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Tags } from '@babylonjs/core/Misc/tags';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { RoomLoader } from '../RoomLoader';

describe('RoomLoader (Babylon.js NullEngine)', () => {
  let engine: NullEngine;
  let scene: Scene;
  let loader: RoomLoader;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    loader = new RoomLoader(scene);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
    vi.restoreAllMocks();
  });

  it('(a) load(roomId) parses GLB / room geometry and categorizes meshes', async () => {
    const root = MeshBuilder.CreateBox('root', {}, scene);
    const walkable = MeshBuilder.CreateBox('Walkable_Ground', {}, scene);
    const navmesh = MeshBuilder.CreateBox('NavMesh_Main', {}, scene);

    vi.spyOn(SceneLoader, 'ImportMeshAsync').mockResolvedValueOnce({
      meshes: [root, walkable, navmesh],
      particleSystems: [],
      skeletons: [],
      animationGroups: [],
      transformNodes: [],
      geometries: [],
      lights: [],
      spriteManagers: [],
    } as any);

    const result = await loader.load('room-park');

    expect(result.rootMesh).toBe(root);
    expect(result.walkableMeshes).toContain(walkable);
    expect(result.navMeshes).toContain(navmesh);
    expect(result.allMeshes.length).toBe(3);
  });

  it('(b) Mesh categorization: NavMesh_* set to isVisible = false, isPickable = false, tagged "navmesh"', () => {
    const navMesh = MeshBuilder.CreateBox('NavMesh_Area', {}, scene);
    loader.processMeshes([navMesh]);

    expect(navMesh.isVisible).toBe(false);
    expect(navMesh.isPickable).toBe(false);
    expect(Tags.HasTags(navMesh)).toBe(true);
    expect(Tags.MatchesQuery(navMesh, 'navmesh')).toBe(true);
  });

  it('(c) Mesh categorization: Walkable_* and Floor tagged "walkable", isPickable = true', () => {
    const walkableMesh = MeshBuilder.CreateBox('Walkable_Path', {}, scene);
    const floorMesh = MeshBuilder.CreateBox('Floor', {}, scene);

    loader.processMeshes([walkableMesh, floorMesh]);

    expect(walkableMesh.isPickable).toBe(true);
    expect(Tags.MatchesQuery(walkableMesh, 'walkable')).toBe(true);

    expect(floorMesh.isPickable).toBe(true);
    expect(Tags.MatchesQuery(floorMesh, 'walkable')).toBe(true);
  });

  it('(d) Mesh categorization: Collision_* set to isVisible = false, isPickable = false, tagged "collision"', () => {
    const collisionMesh = MeshBuilder.CreateBox('Collision_Wall', {}, scene);
    loader.processMeshes([collisionMesh]);

    expect(collisionMesh.isVisible).toBe(false);
    expect(collisionMesh.isPickable).toBe(false);
    expect(Tags.MatchesQuery(collisionMesh, 'collision')).toBe(true);
  });

  it('(e) Other geometry meshes set to isPickable = false', () => {
    const propMesh = MeshBuilder.CreateBox('Prop_Fountain', {}, scene);
    loader.processMeshes([propMesh]);

    expect(propMesh.isPickable).toBe(false);
  });

  it('(f) unload() disposes all tagged meshes (walkable, navmesh, collision)', () => {
    const walkable = MeshBuilder.CreateBox('Walkable_Grass', {}, scene);
    const navmesh = MeshBuilder.CreateBox('NavMesh_Waypoints', {}, scene);
    const collision = MeshBuilder.CreateBox('Collision_Fence', {}, scene);
    const untagged = MeshBuilder.CreateBox('Untagged_Tree', {}, scene);

    loader.processMeshes([walkable, navmesh, collision, untagged]);

    expect(scene.meshes).toContain(walkable);
    expect(scene.meshes).toContain(navmesh);
    expect(scene.meshes).toContain(collision);
    expect(scene.meshes).toContain(untagged);

    loader.unload();

    expect(scene.meshes).not.toContain(walkable);
    expect(scene.meshes).not.toContain(navmesh);
    expect(scene.meshes).not.toContain(collision);
    expect(scene.meshes).toContain(untagged);
  });
});
