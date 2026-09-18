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

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    // authService.logout triggers auth:logout event → socket disconnect
    authService.logout();
    game.scene.stop('RoomScene');
    game.scene.stop('UIScene');
    game.scene.start('LoginScene');
    document.getElementById('game-container')?.classList.add('hidden');
    document.getElementById('room-nav')?.classList.add('hidden');
    document.getElementById('chat-panel')?.classList.add('hidden');
    document.getElementById('avatar-panel')?.classList.add('hidden');
    document.getElementById('player-card')?.classList.add('hidden');
    customizer = null;
  });

  // Return to lobby
  document.getElementById('btn-lobby')?.addEventListener('click', () => {
    game.scene.stop('RoomScene');
    game.scene.stop('UIScene');
    game.scene.start('LobbyScene');
    document.getElementById('game-container')?.classList.add('hidden');
    document.getElementById('chat-panel')?.classList.add('hidden');
  });
});

export { game };
