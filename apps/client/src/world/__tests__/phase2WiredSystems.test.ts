import { describe, it, expect, beforeEach } from 'vitest';
import * as BABYLON from '@babylonjs/core';
import { findPath, findWorldPath } from '../pathfinding';
import { computeStackingHeight } from '../SurfaceManager';
import { ChatOverlay } from '../../ui/ChatOverlay';
import { StreamerModeManager } from '../../ui/StreamerModeManager';
import { CollaborativeWhiteboard } from '../../ui/CollaborativeWhiteboard';
import { AvatarController } from '../AvatarController';

describe('Phase 2: Wired UX & World Systems Functional Validation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    StreamerModeManager.setEnabled(false);
  });

  it('1. 8-Directional A* Pathfinding routes around solid obstacle footprints', () => {
    const obstacles = new Set<string>(['5,4', '5,5', '5,6']);
    const path = findPath({ x: 3, y: 5 }, { x: 7, y: 5 }, 20, obstacles);

    expect(path.length).toBeGreaterThan(2);
    expect(path[0]).toEqual({ x: 3, y: 5 });
    expect(path[path.length - 1]).toEqual({ x: 7, y: 5 });

    // Verify no node in path steps onto a blocked cell
    for (const node of path) {
      expect(obstacles.has(`${node.x},${node.y}`)).toBe(false);
    }
  });

  it('2. findWorldPath converts world coordinates and smooths collinear waypoints around obstacles', () => {
    // Block world origin (0, 0) which maps to grid (30, 30) on halfSpan=15, cellSize=0.5
    const obstacles = new Set<string>(['30,29', '30,30', '30,31']);
    const waypoints = findWorldPath({ x: -2, z: 0 }, { x: 2, z: 0 }, obstacles, 15, 0.5);

    expect(waypoints.length).toBeGreaterThanOrEqual(2);
    expect(waypoints[waypoints.length - 1]).toEqual({ x: 2, z: 0 });
  });

  it('3. SurfaceManager.computeStackingHeight elevates items placed on tables above floor level', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);

    const floor = BABYLON.MeshBuilder.CreateGround('Floor', { width: 10, height: 10 }, scene);
    const table = BABYLON.MeshBuilder.CreateBox('coffee_table', { width: 2, depth: 1, height: 0.8 }, scene);
    table.position.y = 0.4; // top of table is at y = 0.8

    const lamp = BABYLON.MeshBuilder.CreateBox('furniture-lamp', { width: 0.4, depth: 0.4, height: 0.6 }, scene);

    const floorStackY = computeStackingHeight(floor, lamp, 0);
    const tableStackY = computeStackingHeight(table, lamp, 0);

    // On floor: extendSize.y = 0.3 -> y = 0.3
    expect(floorStackY).toBeCloseTo(0.3, 2);
    // On table: topY (0.8) + extendSize.y (0.3) = 1.1
    expect(tableStackY).toBeCloseTo(1.1, 2);

    scene.dispose();
    engine.dispose();
  });

  it('4. ChatOverlay integrates TypingIndicatorManager and StreamerModeManager whisper masking', () => {
    const chat = new ChatOverlay(document.body);
    const input = document.getElementById('chat-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Keystroke triggers typing state
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(chat.typingManager.getIsTyping()).toBe(true);

    // Blur stops typing state
    input.dispatchEvent(new FocusEvent('blur'));
    expect(chat.typingManager.getIsTyping()).toBe(false);

    // Streamer mode masks whispers in chat log
    StreamerModeManager.setEnabled(true);
    chat.appendMessage({
      id: 'm1',
      playerId: 'p2',
      username: 'Alice',
      text: '[Whisper] secret code 123',
      timestamp: Date.now(),
    });

    const log = document.getElementById('chat-log')!;
    expect(log.textContent).toContain('[Whisper Hidden - Streamer Mode]');
    expect(log.textContent).not.toContain('secret code 123');

    chat.dispose();
  });

  it('5. CollaborativeWhiteboard opens interactive modal and records strokes', () => {
    CollaborativeWhiteboard.openModal('room-test');
    const modal = document.getElementById('whiteboard-modal-overlay');
    expect(modal).toBeTruthy();

    const wb = CollaborativeWhiteboard.getInstance();
    wb.clear();
    wb.addStroke({
      authorId: 'u1',
      x0: 10,
      y0: 10,
      x1: 50,
      y1: 50,
      color: '#4ecdc4',
      width: 4,
    });
    expect(wb.exportState().length).toBe(1);

    const closeBtn = document.getElementById('wb-close-btn') as HTMLButtonElement;
    closeBtn.click();
    expect(document.getElementById('whiteboard-modal-overlay')).toBeNull();
  });

  it('6. AvatarController records client-predicted moves in MovementReconciliation', async () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);

    const ctrl = new AvatarController(scene, { id: 'u1', username: 'Tester' });
    await ctrl.init(new BABYLON.Vector3(0, 0, 0));

    ctrl.moveTo(new BABYLON.Vector3(4, 0, 3));
    expect(ctrl.reconciliation.getPendingMoveCount()).toBe(1);

    const res = ctrl.reconciliation.reconcile(1, { x: 4, y: 3 });
    expect(res.reconciled).toBe(false);
    expect(ctrl.reconciliation.getPendingMoveCount()).toBe(0);

    ctrl.dispose();
    scene.dispose();
    engine.dispose();
  });
});
