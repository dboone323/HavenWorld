import { describe, it, expect } from 'vitest';
import { StreamerModeManager } from '../ui/StreamerModeManager';
import { CollaborativeWhiteboard } from '../ui/CollaborativeWhiteboard';

describe('Track 9: Expansive World Building Client Systems', () => {
  describe('9.12: Streamer & Creator Privacy Mode', () => {
    it('should mask sensitive balances and private whispers when streamer mode is active', () => {
      StreamerModeManager.setEnabled(false);
      expect(StreamerModeManager.getIsEnabled()).toBe(false);
      expect(StreamerModeManager.maskSensitiveText(1500)).toBe('1500');
      expect(StreamerModeManager.sanitizeWhisper('Secret trade offer')).toBe('Secret trade offer');

      // Enable streamer mode
      StreamerModeManager.setEnabled(true);
      expect(StreamerModeManager.getIsEnabled()).toBe(true);
      expect(StreamerModeManager.maskSensitiveText(1500)).toBe('••••••');
      expect(StreamerModeManager.sanitizeWhisper('Secret trade offer')).toBe('[Whisper Hidden - Streamer Mode]');
      expect(document.documentElement.classList.contains('streamer-mode')).toBe(true);

      // Reset
      StreamerModeManager.setEnabled(false);
      expect(document.documentElement.classList.contains('streamer-mode')).toBe(false);
    });
  });

  describe('9.14: Interactive Collaborative Whiteboards', () => {
    it('should record, serialize, and reconstruct vector whiteboard strokes', () => {
      const board = new CollaborativeWhiteboard(800, 600);
      expect(board.strokes.length).toBe(0);

      const stroke1 = board.addStroke({
        authorId: 'user_artist_1',
        x0: 10,
        y0: 15,
        x1: 45,
        y1: 60,
        color: '#ff0055',
        width: 3,
      });

      expect(stroke1.id).toBeDefined();
      expect(board.strokes.length).toBe(1);

      const exported = board.exportState();
      expect(exported.length).toBe(1);
      expect(exported[0].color).toBe('#ff0055');

      // Reconstruct on another client
      const clientBoard = new CollaborativeWhiteboard(800, 600);
      clientBoard.loadState(exported);
      expect(clientBoard.strokes.length).toBe(1);
      expect(clientBoard.strokes[0].authorId).toBe('user_artist_1');

      // Clear
      clientBoard.clear();
      expect(clientBoard.strokes.length).toBe(0);
    });
  });
});
