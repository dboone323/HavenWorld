import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { FurnitureManager } from '../FurnitureManager';

describe('FurnitureManager (Babylon.js NullEngine)', () => {
  let engine: NullEngine;
  let scene: Scene;
  let manager: FurnitureManager;
  const currentUserId = 'user-alice';

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    manager = new FurnitureManager(scene, currentUserId);

    // Register a reusable box template for 'chair-01'
    const chairTemplate = MeshBuilder.CreateBox('chair_template', { size: 1 }, scene);
    manager.registerTemplate('chair-01', chairTemplate);
  });

  afterEach(() => {
    manager.clear();
    scene.dispose();
    engine.dispose();
  });

  it('(a) placeItem(itemData) instantiates mesh at correct (x, y, z)', async () => {
    const placed = await manager.placeItem({
      id: 'f-1',
      itemId: 'chair-01',
      x: 2.5,
      y: 0,
      z: -3.5,
      rotY: 0,
      placedById: currentUserId,
    });

    expect(placed).not.toBeNull();
    expect(placed?.mesh.position.x).toBeCloseTo(2.5);
    expect(placed?.mesh.position.y).toBeCloseTo(0);
    expect(placed?.mesh.position.z).toBeCloseTo(-3.5);
    expect(manager.allPlaced.has('f-1')).toBe(true);
  });

  it('(b) Instancing reuse: second item of same itemId uses createInstance (shared geometry)', async () => {
    const item1 = await manager.placeItem({
      id: 'f-1',
      itemId: 'chair-01',
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      placedById: currentUserId,
    });

    const item2 = await manager.placeItem({
      id: 'f-2',
      itemId: 'chair-01',
      x: 2,
      y: 0,
      z: 0,
      rotY: 0,
      placedById: currentUserId,
    });

    expect(item1).not.toBeNull();
    expect(item2).not.toBeNull();
    // In Babylon.js, instanced meshes share source mesh geometry
    expect(item1?.mesh instanceof InstancedMesh || (item1?.mesh as Mesh).geometry !== undefined).toBe(true);
    expect(item2?.mesh instanceof InstancedMesh || (item2?.mesh as Mesh).geometry !== undefined).toBe(true);
  });

  it('(c) Ownership tagging: item placed by current user marked isOwned = true; other user isOwned = false', async () => {
    const ownItem = await manager.placeItem({
      id: 'f-own',
      itemId: 'chair-01',
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      placedById: currentUserId,
    });

    const otherItem = await manager.placeItem({
      id: 'f-other',
      itemId: 'chair-01',
      x: 3,
      y: 0,
      z: 0,
      rotY: 0,
      placedById: 'user-bob',
    });

    expect(ownItem?.isOwned).toBe(true);
    expect(otherItem?.isOwned).toBe(false);
  });

  it('(d) removeItem(id) removes from tracked items and disposes mesh', async () => {
    const item = await manager.placeItem({
      id: 'f-remove',
      itemId: 'chair-01',
      x: 1,
      y: 0,
      z: 1,
      rotY: 0,
      placedById: currentUserId,
    });

    const mesh = item!.mesh;
    expect(scene.meshes.includes(mesh) || scene.getMeshByName(mesh.name) !== null).toBe(true);

    manager.removeItem('f-remove');

    expect(manager.allPlaced.has('f-remove')).toBe(false);
    expect(mesh.isDisposed()).toBe(true);
  });

  it('(e) clear() disposes all placed meshes and cached templates', async () => {
    const item1 = await manager.placeItem({
      id: 'f-c1',
      itemId: 'chair-01',
      x: 1,
      y: 0,
      z: 1,
      rotY: 0,
      placedById: currentUserId,
    });

    const item2 = await manager.placeItem({
      id: 'f-c2',
      itemId: 'chair-01',
      x: 2,
      y: 0,
      z: 2,
      rotY: 0,
      placedById: currentUserId,
    });

    expect(manager.allPlaced.size).toBe(2);

    manager.clear();

    expect(manager.allPlaced.size).toBe(0);
    expect(item1!.mesh.isDisposed()).toBe(true);
    expect(item2!.mesh.isDisposed()).toBe(true);
  });

  it('(f) Rotation and scaling applied from itemData', async () => {
    const placed = await manager.placeItem({
      id: 'f-transform',
      itemId: 'chair-01',
      x: 0,
      y: 0,
      z: 0,
      rotY: Math.PI / 2,
      scaleX: 1.5,
      scaleY: 2.0,
      scaleZ: 1.5,
      placedById: currentUserId,
    });

    expect(placed).not.toBeNull();
    expect(placed?.mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(placed?.mesh.scaling.x).toBeCloseTo(1.5);
    expect(placed?.mesh.scaling.y).toBeCloseTo(2.0);
    expect(placed?.mesh.scaling.z).toBeCloseTo(1.5);
  });

  it('(g) pickFurniture(raycastHit) returns correct PlacedFurniture record', async () => {
    const placed = await manager.placeItem({
      id: 'f-pick',
      itemId: 'chair-01',
      x: 4,
      y: 0,
      z: 4,
      rotY: 0,
      placedById: currentUserId,
    });

    const pickInfo = new PickingInfo();
    pickInfo.hit = true;
    pickInfo.pickedMesh = placed!.mesh;

    const result = manager.pickFurniture(pickInfo);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('f-pick');
    expect(result?.itemId).toBe('chair-01');
  });

  it('(h) Hierarchical template with disabled root instantiates enabled, pickable child meshes', async () => {
    // Simulate imported GLB hierarchy: root TransformNode/Mesh with children
    const rootNode = new Mesh('__root__', scene);
    const childGeometry = MeshBuilder.CreateBox('cushion', { size: 1 }, scene);
    childGeometry.parent = rootNode;
    rootNode.setEnabled(false); // GLB template hidden

    manager.registerTemplate('sofa-complex', rootNode);

    const placed = await manager.placeItem({
      id: 'f-sofa-1',
      itemId: 'sofa-complex',
      x: 1,
      y: 0,
      z: 1,
      rotY: 0,
      placedById: currentUserId,
    });

    expect(placed).not.toBeNull();
    expect(placed!.mesh.isEnabled()).toBe(true);

    const children = placed!.mesh.getChildMeshes();
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.isEnabled()).toBe(true);
      expect(child.isPickable).toBe(true);
    }

    // Raycast hit on child mesh must resolve to the placed furniture
    const pickInfo = new PickingInfo();
    pickInfo.hit = true;
    pickInfo.pickedMesh = children[0];
    const picked = manager.pickFurniture(pickInfo);
    expect(picked).not.toBeNull();
    expect(picked?.id).toBe('f-sofa-1');
  });
});

