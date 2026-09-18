import Phaser from 'phaser';
import { BootScene }   from './scenes/BootScene';
import { LoginScene }  from './scenes/LoginScene';
import { LobbyScene }  from './scenes/LobbyScene';
import { RoomScene }   from './scenes/RoomScene';
import { UIScene }     from './scenes/UIScene';
import { mountLoginUI } from './ui/loginUI';
import { AvatarCustomizer } from './ui/AvatarCustomizer';
import { authService } from './services/auth';
import './style.css';

// ── Handle Email Verification Token redirect ──────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const verifyToken = urlParams.get('token');
if (verifyToken) {
  const SERVER = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://147-224-164-228.nip.io' : '');
  window.location.href = `${SERVER}/api/auth/verify?token=${verifyToken}`;
}

// ── Phaser game configuration ──────────────────────────────────────────────

const config: Phaser.Types.Core.GameConfig = {
  type:            Phaser.AUTO,   // WebGL with Canvas fallback
  width:           1024,
  height:          768,
  backgroundColor: '#1a1a2e',
  parent:          'game-container',
  scene: [BootScene, LoginScene, LobbyScene, RoomScene, UIScene],
  scale: {
    mode:            Phaser.Scale.FIT,
    autoCenter:      Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade:  { gravity: { x: 0, y: 0 }, debug: false },
  },
};

// ── Boot ──────────────────────────────────────────────────────────────────

const game = new Phaser.Game(config);

// ── DOM wiring ────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Login UI
  mountLoginUI(game);

  // Avatar customizer (lazy init on first open)
  let customizer: AvatarCustomizer | null = null;

  document.getElementById('btn-avatar')?.addEventListener('click', () => {
    const panel = document.getElementById('avatar-panel');
    if (!panel) return;
    if (!customizer) customizer = new AvatarCustomizer(panel);
    else customizer.open();
    panel.classList.toggle('hidden');
  });

  // ── In-game navigation buttons ──────────────────────────────────────────
  // Fast travel to Haven Park
  document.getElementById('btn-park')?.addEventListener('click', () => {
    document.getElementById('lobby-panel')?.classList.add('hidden');
    game.scene.start('RoomScene', { roomId: 'room-park', mapKey: 'park' });
    if (!game.scene.isActive('UIScene')) {
      game.scene.launch('UIScene');
    }
  });

  // Return to personal loft
  document.getElementById('btn-my-loft')?.addEventListener('click', () => {
    document.getElementById('lobby-panel')?.classList.add('hidden');
    const loftId = authService.user?.personalRoom?.id;
    if (loftId) {
      game.scene.start('RoomScene', { roomId: loftId, mapKey: 'personal-room' });
      if (!game.scene.isActive('UIScene')) {
        game.scene.launch('UIScene');
      }
    }
  });

  // Open travel / lofts directory
  document.getElementById('btn-browse-lofts')?.addEventListener('click', () => {
    game.scene.stop('RoomScene');
    game.scene.stop('UIScene');
    game.scene.start('LobbyScene');
    document.getElementById('game-container')?.classList.add('hidden');
    document.getElementById('chat-panel')?.classList.add('hidden');
    document.getElementById('lobby-panel')?.classList.remove('hidden');
  });

  // Logout handler
  const handleLogout = () => {
    authService.logout();
    game.scene.stop('RoomScene');
    game.scene.stop('UIScene');
    game.scene.stop('LobbyScene');
    game.scene.start('LoginScene');
    document.getElementById('lobby-panel')?.classList.add('hidden');
    document.getElementById('game-container')?.classList.add('hidden');
    document.getElementById('room-nav')?.classList.add('hidden');
    document.getElementById('chat-panel')?.classList.add('hidden');
    document.getElementById('avatar-panel')?.classList.add('hidden');
    document.getElementById('player-card')?.classList.add('hidden');
    customizer = null;
  };

  document.getElementById('btn-nav-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
});

export { game };
