import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../services/authService';
import { blockService } from '../services/blockService';
import { ChatOverlay } from '../ui/ChatOverlay';
import { PassportModal } from '../passport/PassportModal';
import { HelpModal } from '../ui/HelpModal';
import type { AvatarData, ChatMessage } from '@havenworld/shared';

// Helper to generate a real structural JWT without signature dependencies
function createRealTestJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode(header)}.${encode(payload)}.realsignaturebytes`;
}

describe('Enhancements & Security Hardening Real Functional Validations', () => {
  let testContainer: HTMLElement;

  beforeEach(() => {
    testContainer = document.createElement('div');
    testContainer.id = 'test-container';
    document.body.appendChild(testContainer);
    blockService.clear();
    localStorage.clear();
  });

  afterEach(() => {
    blockService.clear();
    localStorage.clear();
    testContainer.remove();
    document.body.innerHTML = '';
  });

  describe('1. In-Memory Token Storage & Expiry Hardening (§9.10)', () => {
    it('keeps session tokens strictly in memory and never persists them to localStorage', () => {
      const auth = new AuthService('http://localhost:3000/api');

      // Ensure no leftover tokens exist in persistent storage
      expect(localStorage.getItem('haven_token')).toBeNull();
      expect(auth.token).toBeNull();

      // Create a valid future-expiring JWT
      const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour future
      const realJwt = createRealTestJwt({
        id: 'usr-1234',
        username: 'HavenTraveler',
        exp: futureExp,
      });

      // Set session into in-memory service
      auth.setSession(realJwt, {
        id: 'usr-1234',
        username: 'HavenTraveler',
        email: 'traveler@haven.world',
      });

      // Verify in-memory state is active
      expect(auth.token).toBe(realJwt);
      expect(auth.user?.username).toBe('HavenTraveler');
      expect(auth.isAuthenticated()).toBe(true);

      // Verify localStorage was NOT touched - preventing XSS token exfiltration
      expect(localStorage.getItem('haven_token')).toBeNull();
      expect(localStorage.getItem('accessToken')).toBeNull();
    });

    it('correctly evaluates token expiration window without mocks', () => {
      const auth = new AuthService('http://localhost:3000/api');

      // Create a token expiring within the 60s safety buffer (e.g. 30 seconds from now)
      const nearExp = Math.floor(Date.now() / 1000) + 30;
      const expiringJwt = createRealTestJwt({
        id: 'usr-exp',
        username: 'ExpiringUser',
        exp: nearExp,
      });

      auth.setSession(expiringJwt, {
        id: 'usr-exp',
        username: 'ExpiringUser',
        email: 'exp@haven.world',
      });

      // Should be considered expired/unsafe because it is within the 60s safety window
      expect(auth.isAuthenticated()).toBe(false);

      // Create an expired token (100 seconds in past)
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const expiredJwt = createRealTestJwt({
        id: 'usr-old',
        username: 'OldUser',
        exp: pastExp,
      });

      auth.setSession(expiredJwt, {
        id: 'usr-old',
        username: 'OldUser',
        email: 'old@haven.world',
      });
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  describe('2. Player Block & Mute System Functional State (§5.2)', () => {
    it('manages blocked user IDs set and responds accurately to queries', () => {
      const targetUserId = 'spammer-uuid-456';

      expect(blockService.isBlocked(targetUserId)).toBe(false);
      expect(blockService.getBlockedUserIds().has(targetUserId)).toBe(false);

      blockService.setBlockedLocally(targetUserId, true);
      expect(blockService.isBlocked(targetUserId)).toBe(true);
      expect(blockService.getBlockedUserIds().has(targetUserId)).toBe(true);

      blockService.setBlockedLocally(targetUserId, false);
      expect(blockService.isBlocked(targetUserId)).toBe(false);
      expect(blockService.getBlockedUserIds().has(targetUserId)).toBe(false);
    });
  });

  describe('3. ChatOverlay Filtering against Blocked Players', () => {
    it('suppresses chat messages emitted by blocked players while displaying allowed messages', () => {
      const chat = new ChatOverlay(testContainer);
      const chatLog = document.getElementById('chat-log');
      expect(chatLog).not.toBeNull();

      const blockedSenderId = 'toxic-player-777';
      const friendlySenderId = 'friendly-player-888';

      // Mark the toxic player as blocked
      blockService.setBlockedLocally(blockedSenderId, true);

      // Attempt to append message from blocked player
      const blockedMsg: ChatMessage = {
        id: 'msg-1',
        senderId: blockedSenderId,
        username: 'BadActor',
        content: 'This message should be completely blocked',
        timestamp: Date.now(),
      };
      chat.appendMessage(blockedMsg);

      // Chat log must remain empty
      expect(chatLog?.children.length).toBe(0);

      // Append message from friendly player
      const friendlyMsg: ChatMessage = {
        id: 'msg-2',
        senderId: friendlySenderId,
        username: 'FriendlyNeighbor',
        content: 'Welcome to our Haven!',
        timestamp: Date.now(),
      };
      chat.appendMessage(friendlyMsg);

      // Chat log must now contain exactly 1 entry from FriendlyNeighbor
      expect(chatLog?.children.length).toBe(1);
      const textContent = chatLog?.firstElementChild?.textContent || '';
      expect(textContent).toContain('FriendlyNeighbor');
      expect(textContent).toContain('Welcome to our Haven!');

      chat.dispose();
    });
  });

  describe('4. 2D Chibi Avatar Preview on Citizen Passport', () => {
    it('generates layered avatar badge containing wearable sprite paths for customized avatars', () => {
      const passportModal = new PassportModal();

      const customizedAvatar: AvatarData = {
        skinColor: '#ffe0bd',
        gender: 'female',
        hairColor: '#ffd700',
        hairStyle: 'wavy_gold',
        outfitBody: 'sweater_pink',
        outfitHead: 'trapper_hat',
        shoes: 'boots',
        eyes: 'blue',
      };

      const badgeHtml = passportModal.renderAvatarBadge(customizedAvatar);

      // Verify the badge container structure
      expect(badgeHtml).toContain('class="passport-avatar-badge"');
      // Verify base character sprite layer
      expect(badgeHtml).toContain('MiPlanet Character Base Sprite.png');
      // Verify top sweater layer
      expect(badgeHtml).toContain('MiPlanet Pink Llama Sweater.png');
      // Verify hair layer
      expect(badgeHtml).toContain('MiPlanet Wavy Golden Hair.png');
      // Verify hat layer
      expect(badgeHtml).toContain('MiPlanet Trapper Hat.png');
      // Verify eyes layer
      expect(badgeHtml).toContain('MiPlanet Basic Blue Eyes.png');
    });

    it('generates base sprite badge when avatar has minimal or default wearables', () => {
      const passportModal = new PassportModal();
      const defaultAvatar: AvatarData = {
        skinColor: '#ffe0bd',
        gender: 'neutral',
        hairColor: '#000000',
        hairStyle: 'none',
        outfitBody: 'none',
        shoes: 'none',
        eyes: '',
      };

      const badgeHtml = passportModal.renderAvatarBadge(defaultAvatar);
      expect(badgeHtml).toContain('class="passport-avatar-badge"');
      expect(badgeHtml).toContain('MiPlanet Character Base Sprite.png');
      // None of the extra clothes layers should be injected
      expect(badgeHtml).not.toContain('MiPlanet Pink Llama Sweater.png');
      expect(badgeHtml).not.toContain('MiPlanet Trapper Hat.png');
    });
  });

  describe('5. Help & Controls Walkthrough Modal', () => {
    it('opens and closes walkthrough modal displaying comprehensive game controls', () => {
      const help = HelpModal.getInstance();

      expect(help.isOpen()).toBe(false);
      expect(document.getElementById('help-modal-overlay')).toBeNull();

      help.open();
      expect(help.isOpen()).toBe(true);

      const overlay = document.getElementById('help-modal-overlay');
      expect(overlay).not.toBeNull();

      const panel = document.getElementById('help-modal-panel');
      expect(panel).not.toBeNull();
      const content = panel?.textContent || '';

      // Verify essential gameplay and keyboard controls are presented
      expect(content).toContain('Move Avatar');
      expect(content).toContain('WASD / Click');
      expect(content).toContain('Sit / Stand');
      expect(content).toContain('Space');
      expect(content).toContain('Rotate Furniture');
      expect(content).toContain('R Key');
      expect(content).toContain('Personal Sanctuary & Decorator');
      expect(content).toContain('Wardrobe & Authentic 2D Chibi Style');

      // Close modal
      help.close();
      expect(help.isOpen()).toBe(false);
      expect(document.getElementById('help-modal-overlay')).toBeNull();
    });
  });
});
