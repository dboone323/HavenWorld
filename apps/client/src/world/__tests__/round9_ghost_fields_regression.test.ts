import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as BABYLON from '@babylonjs/core';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { FurnitureManager } from '../FurnitureManager';
import { RoomEditor } from '../RoomEditor';
import { authService } from '../../services/authService';

describe('Round 9 regression: ghost fields survive GLB load', () => {
  let engine: NullEngine;
  let scene: Scene;
  let fm: FurnitureManager;
  let editor: RoomEditor;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    fm = new FurnitureManager(scene, 'user-1');
    editor = new RoomEditor(scene, fm, 'room-1', 0);
    editor.enterEditMode();
    (authService as any)._accessToken = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

    const mesh = MeshBuilder.CreateBox('ghost_glb', { size: 1 }, scene);
    vi.spyOn(BABYLON.SceneLoader, 'ImportMeshAsync').mockResolvedValue({ meshes: [mesh] } as any);
  });

  afterEach(() => {
    editor.dispose();
    fm.clear();
    scene.dispose();
    engine.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Save Layout body includes the item after the GLB ghost loads', async () => {
    editor.startPlacement('furniture-plant', '/assets/furniture/furniture-plant.glb');
    // Let the mocked GLB load resolve.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect((editor as any).ghostMesh).not.toBeNull();
    expect(editor.hasPendingChanges()).toBe(true);

    await editor.saveLayout();
    const call = (globalThis.fetch as any).mock.calls.find((c: any) => c[1]?.body);
    const body = JSON.parse(call[1].body);
    expect(body.layout.map((i: any) => i.itemId)).toContain('furniture-plant');
  });

  it('Finish Decorating body includes the item after the GLB ghost loads', async () => {
    editor.startPlacement('furniture-lamp', '/assets/furniture/furniture-lamp.glb');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    await editor.finishDecorating();
    const call = (globalThis.fetch as any).mock.calls.find((c: any) => c[1]?.body);
    const body = JSON.parse(call[1].body);
    expect(body.layout.map((i: any) => i.itemId)).toContain('furniture-lamp');
  });
});
