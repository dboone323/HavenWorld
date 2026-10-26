import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FurnitureManager } from '../FurnitureManager';
import { RoomEditor } from '../RoomEditor';
import { authService } from '../../services/authService';

describe('Round 8 regression: uncommitted ghost included in save', () => {
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
  });

  afterEach(() => {
    editor.dispose();
    fm.clear();
    scene.dispose();
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it('Save Layout body includes an uncommitted ghost placement', async () => {
    editor.startPlacement('furniture-plant', '/assets/furniture/furniture-plant.glb'); // do not await
    expect((editor as any).ghostMesh).not.toBeNull();
    expect(editor.hasPendingChanges()).toBe(true);

    await editor.saveLayout();
    const call = (globalThis.fetch as any).mock.calls.find((c: any) => c[1]?.body);
    const body = JSON.parse(call[1].body);
    expect(body.layout.map((i: any) => i.itemId)).toContain('furniture-plant');
  });

  it('Finish Decorating body includes an uncommitted ghost placement', async () => {
    editor.startPlacement('furniture-lamp', '/assets/furniture/furniture-lamp.glb'); // do not await
    expect((editor as any).ghostMesh).not.toBeNull();

    await editor.finishDecorating();
    const call = (globalThis.fetch as any).mock.calls.find((c: any) => c[1]?.body);
    const body = JSON.parse(call[1].body);
    expect(body.layout.map((i: any) => i.itemId)).toContain('furniture-lamp');
  });
});
