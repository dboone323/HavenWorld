import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FurnitureManager } from '../FurnitureManager';
import { RoomEditor } from '../RoomEditor';
import { authService } from '../../services/authService';

describe('Round 6 regression: dock Finish Decorating save path', () => {
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

  it('saveLayout sends a request even with no pending changes (dock path)', async () => {
    expect(editor.hasPendingChanges()).toBe(false);
    await editor.finishDecorating();
    const call = (globalThis.fetch as any).mock.calls.find((c: any) => c[1]?.body);
    expect(call).toBeTruthy();
  });
});
