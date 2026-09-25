import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FurnitureManager } from '../FurnitureManager';
import { RoomEditor } from '../RoomEditor';

describe('RoomEditor (Babylon.js NullEngine)', () => {
  let engine: NullEngine;
  let scene: Scene;
  let furnitureManager: FurnitureManager;
  let editor: RoomEditor;
  const currentUserId = 'user-decorator-1';
  const roomId = 'room-test-101';
  let modeState: boolean | null = null;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    furnitureManager = new FurnitureManager(scene, currentUserId);
    modeState = null;
    editor = new RoomEditor(
      scene,
      furnitureManager,
      roomId,
      0,
      (inEditMode) => {
        modeState = inEditMode;
      }
    );
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    editor.dispose();
    furnitureManager.clear();
    scene.dispose();
    engine.dispose();
  });

  it('(a) Snap toggle correctly modifies snap rounding behavior', () => {
    // By default, snapEnabled is true (0.5m grid step)
    expect(editor.snapEnabled).toBe(true);

    const rawPos1 = new Vector3(1.23, 0, 4.88);
    const snapped1 = editor.snapToGrid(rawPos1);
    expect(snapped1.x).toBeCloseTo(1.0);
    expect(snapped1.z).toBeCloseTo(5.0);

    const rawPos2 = new Vector3(2.26, 0, -1.74);
    const snapped2 = editor.snapToGrid(rawPos2);
    expect(snapped2.x).toBeCloseTo(2.5);
    expect(snapped2.z).toBeCloseTo(-1.5);

    // Disable snapping
    editor.setSnapEnabled(false);
    expect(editor.snapEnabled).toBe(false);

    const rawPos3 = new Vector3(1.234, 0, 4.876);
    const freePos = editor.snapToGrid(rawPos3);
    expect(freePos.x).toBeCloseTo(1.234);
    expect(freePos.z).toBeCloseTo(4.876);
  });

  it('(b) Grid toggle enables and disables editor_grid mesh in the scene', () => {
    expect(editor.getGridMesh()).toBeNull();

    // Enter edit mode -> grid is created
    editor.enterEditMode();
    expect(editor.inEditMode).toBe(true);
    expect(modeState).toBe(true);

    const gridMesh = editor.getGridMesh();
    expect(gridMesh).not.toBeNull();
    expect(gridMesh?.name).toBe('editor_grid');
    expect(scene.getMeshByName('editor_grid')).toBe(gridMesh);

    // Toggle grid off
    editor.setGridVisible(false);
    expect(editor.gridVisible).toBe(false);
    expect(editor.getGridMesh()).toBeNull();
    expect(scene.getMeshByName('editor_grid')).toBeNull();

    // Toggle grid on
    editor.setGridVisible(true);
    expect(editor.gridVisible).toBe(true);
    expect(editor.getGridMesh()).not.toBeNull();
    expect(scene.getMeshByName('editor_grid')?.name).toBe('editor_grid');
  });

  it('(c) Dirty tracking & cancel guard prevents accidental dismissal of uncommitted layout changes', () => {
    editor.enterEditMode();
    expect(editor.hasPendingChanges()).toBe(false);

    // Add a pending placement to simulate dirty state
    editor.addPendingPlacement({
      id: 'temp-placement-1',
      itemId: 'chair-oak',
      x: 3.5,
      y: 0,
      z: 2.0,
      rotY: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      isNew: true,
    });
    expect(editor.hasPendingChanges()).toBe(true);

    // Case 1: User clicks "Cancel" on browser confirmation dialog -> keep editing
    let confirmPromptCalled = false;
    window.confirm = (message?: string) => {
      confirmPromptCalled = true;
      expect(message).toContain('unsaved');
      return false; // User clicks "Cancel" (do not discard)
    };

    editor.cancelEdit();
    expect(confirmPromptCalled).toBe(true);
    expect(editor.inEditMode).toBe(true);
    expect(editor.hasPendingChanges()).toBe(true);

    // Case 2: User clicks "OK" to discard -> exits edit mode and clears changes
    window.confirm = () => true; // User clicks "OK" (discard changes)
    editor.cancelEdit();
    expect(editor.inEditMode).toBe(false);
    expect(editor.hasPendingChanges()).toBe(false);
    expect(modeState).toBe(false);
  });
});
