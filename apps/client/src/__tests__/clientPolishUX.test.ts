import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SmoothCamera } from '../world/SmoothCamera';
import { DraggablePanel } from '../ui/DraggablePanel';
import { MinimapRadar } from '../ui/MinimapRadar';
import { IdleStateManager } from '../engine/IdleStateManager';
import { MovementReconciliation } from '../engine/MovementReconciliation';
import { AccessibilityManager } from '../ui/AccessibilityManager';
import { TypingIndicatorManager } from '../ui/TypingIndicatorManager';

describe('Track 8: Advanced Client Polish & UX', () => {
  describe('8.1: Smooth Camera Following', () => {
    it('should interpolate camera position towards target without instantaneous jumps', () => {
      const camera = new SmoothCamera({ x: 0, y: 0 }, 0.1, 0.01);
      camera.setTarget({ x: 100, y: 200 });

      // First tick should smoothly move towards target
      const step1 = camera.update(1.0);
      expect(step1.x).toBeGreaterThan(0);
      expect(step1.x).toBeLessThan(100);
      expect(step1.y).toBeGreaterThan(0);
      expect(step1.y).toBeLessThan(200);

      // Subsequent ticks approach closer
      const step2 = camera.update(1.0);
      expect(step2.x).toBeGreaterThan(step1.x);
      expect(step2.y).toBeGreaterThan(step1.y);

      // Snap jumps directly
      camera.snapToTarget();
      expect(camera.position.x).toBe(100);
      expect(camera.position.y).toBe(200);
    });
  });

  describe('8.3: Draggable & Resizable UI Panels', () => {
    it('should clamp panel dragging within viewport bounds', () => {
      const panel = document.createElement('div');
      panel.style.width = '200px';
      panel.style.height = '150px';
      document.body.appendChild(panel);

      const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
      const { destroy } = DraggablePanel.makeDraggable(panel, panel, () => bounds);

      // Simulate mousedown
      panel.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50 }));

      // Move outside right bounds (to 1000px)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1050, clientY: 50 }));

      // Position must be clamped to maxX (800px)
      expect(panel.style.left).toBe('800px');

      // Release
      window.dispatchEvent(new MouseEvent('mouseup'));
      destroy();
      panel.remove();
    });
  });

  describe('8.4: Minimap Radar', () => {
    it('should project room coordinates into normalized radar coordinates and create blips', () => {
      const radar = new MinimapRadar(20, 20, 140);

      // Center of room (10, 10) in 20x20 room
      const centerProj = radar.projectToRadar(10, 10);
      expect(centerProj.x).toBe(0.5);
      expect(centerProj.y).toBe(0.5);

      const pixelPos = radar.getPixelPosition(centerProj.x, centerProj.y);
      expect(pixelPos.px).toBe(70);
      expect(pixelPos.py).toBe(70);

      // Create local player blip
      const blip = radar.createBlip('player_1', 'local_player', 5, 15);
      expect(blip.color).toBe('#10b981');
      expect(blip.x).toBe(0.25);
      expect(blip.y).toBe(0.75);
    });
  });

  describe('8.5: AFK & Idle Dimming State', () => {
    it('should transition presence states based on elapsed inactivity', () => {
      const idleManager = new IdleStateManager(10_000, 30_000); // 10s idle, 30s AFK
      const now = Date.now();

      expect(idleManager.currentState).toBe('ACTIVE');

      // 5s elapsed: still active
      expect(idleManager.checkInactivity(now + 5_000)).toBe('ACTIVE');

      // 15s elapsed: becomes IDLE
      expect(idleManager.checkInactivity(now + 15_000)).toBe('IDLE');

      // 35s elapsed: becomes AFK
      expect(idleManager.checkInactivity(now + 35_000)).toBe('AFK');

      // Activity report resets to ACTIVE
      idleManager.reportActivity();
      expect(idleManager.currentState).toBe('ACTIVE');
    });
  });

  describe('8.6: Client-Side Prediction & Reconciliation', () => {
    it('should predict inputs and reconcile drift beyond epsilon threshold', () => {
      const recon = new MovementReconciliation({ x: 0, y: 0 }, 0.5);

      // Client predicts moves
      const move1 = recon.addPredictedMove(2, 0); // seq 1
      const move2 = recon.addPredictedMove(4, 0); // seq 2
      expect(recon.currentPosition.x).toBe(4);
      expect(recon.getPendingMoveCount()).toBe(2);

      // Server acknowledges move1 (server confirmed at x=2, y=0)
      const res1 = recon.reconcile(move1.seq, { x: 2, y: 0 });
      expect(res1.reconciled).toBe(false); // No drift, predicted position was accurate
      expect(recon.getPendingMoveCount()).toBe(1);

      // Server acknowledges move2 with drift beyond epsilon (server says wall blocked at x=3, y=0)
      const res2 = recon.reconcile(move2.seq, { x: 3, y: 0 });
      expect(res2.reconciled).toBe(true);
      expect(res2.correctedPosition.x).toBe(3);
      expect(recon.currentPosition.x).toBe(3);
    });
  });

  describe('8.9: Accessibility & Colorblind Modes', () => {
    it('should apply UI scaling, dyslexia fonts, and colorblind filters to document', () => {
      const a11y = AccessibilityManager.getInstance();

      // UI Scale
      a11y.setUiScale(1.25);
      expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25');

      // High contrast
      a11y.setColorblindMode('high_contrast');
      expect(document.documentElement.style.getPropertyValue('--chat-contrast')).toBe('1.4');

      // Dyslexia font
      a11y.setDyslexiaFont(true);
      expect(document.documentElement.classList.contains('dyslexia-font')).toBe(true);
    });
  });

  describe('8.11: Chat Typing Indicators', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should manage debounced typing states', () => {
      const typingManager = new TypingIndicatorManager(500);
      let isTypingReported = false;

      typingManager.subscribe((typing) => {
        isTypingReported = typing;
      });

      // Keystroke starts typing
      typingManager.handleKeystroke();
      expect(typingManager.getIsTyping()).toBe(true);
      expect(isTypingReported).toBe(true);

      // Fast forward past debounce window (500ms)
      vi.advanceTimersByTime(600);
      expect(typingManager.getIsTyping()).toBe(false);
      expect(isTypingReported).toBe(false);

      // Manual stop
      typingManager.handleKeystroke();
      expect(typingManager.getIsTyping()).toBe(true);
      typingManager.stopTyping();
      expect(typingManager.getIsTyping()).toBe(false);
    });
  });
});
