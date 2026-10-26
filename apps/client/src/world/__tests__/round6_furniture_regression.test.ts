import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FurnitureManager } from '../FurnitureManager';
import { RoomEditor } from '../RoomEditor';
import { authService } from '../../services/authService';

describe('Round 6 regression: furniture save includes newly placed item', () => {
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

  it('serializes a pending new placement even if not yet in FurnitureManager', async () => {
    editor.addPendingPlacement({
      id: 'new_pending_plant',
      itemId: 'furniture-plant',
      x: 1,
      y: 0,
      z: 1,
      rotY: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      isNew: true,
      assetUrl: '/assets/furniture/furniture-plant.glb',
    } as any);

    await editor.saveLayout();
    const call = (globalThis.fetch as any).mock.calls.find((c: any) => c[1]?.body);
    const body = JSON.parse(call[1].body);
    expect(body.layout.map((i: any) => i.itemId)).toContain('furniture-plant');
  });
});
