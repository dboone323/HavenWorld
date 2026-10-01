import { createServer, Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Tags } from '@babylonjs/core/Misc/tags';
import { RoomLoader } from '../RoomLoader';
import { setAssetBaseUrl } from '../../config';

describe('RoomLoader (Babylon.js NullEngine — Real GLB & Mesh Validation)', () => {
  let server: Server;
  let engine: NullEngine;
  let scene: Scene;
  let loader: RoomLoader;

  beforeAll(async () => {
    const glbPath = path.resolve(__dirname, '../../../public/assets/rooms/town_square.glb');
    const glbBuffer = readFileSync(glbPath);

    server = createServer((req, res) => {
      if (req.url?.endsWith('.glb')) {
        res.writeHead(200, {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': glbBuffer.byteLength,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(glbBuffer);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    setAssetBaseUrl(`http://127.0.0.1:${addr.port}`);
  });

  afterAll(async () => {
    setAssetBaseUrl('');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    loader = new RoomLoader(scene);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it('(a) load(roomId) parses real town_square.glb binary and categorizes meshes', async () => {
    expect(RoomLoader.hasStaticGlb('room-town-square')).toBe(true);
    expect(RoomLoader.hasStaticGlb('room-park')).toBe(false);
    expect(RoomLoader.resolveGlbId('room-town-square')).toBe('town_square');

    const result = await loader.load('town_square');

    expect(result.rootMesh).toBeDefined();
    expect(result.allMeshes.length).toBeGreaterThan(0);
    expect(result.walkableMeshes.length).toBeGreaterThan(0);
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
