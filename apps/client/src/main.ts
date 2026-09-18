import { HavenEngine } from './engine/HavenEngine';
import { SceneManager } from './engine/SceneManager';
import { createLoginScene } from './scenes/LoginScene';
import { createLobbyScene } from './scenes/LobbyScene';
import { createRoomScene } from './scenes/RoomScene';
import { mountLoginUI } from './ui/loginUI';
import { AvatarCustomizer } from './ui/AvatarCustomizer';
import { authService } from './services/auth';
import './style.css';

// ── Handle Email Verification Token redirect ──────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const verifyToken = urlParams.get('token');
if (verifyToken) {
  const SERVER =
    import.meta.env.VITE_SERVER_URL ||
    (import.meta.env.PROD ? 'https://147-224-164-228.nip.io' : '');
  window.location.href = `${SERVER}/api/auth/verify?token=${verifyToken}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Login UI HTML form setup
  mountLoginUI();

  // Get Canvas and initialize Babylon Engine
  const canvas = document.getElementById('haven-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[HavenWorld] Canvas element #haven-canvas not found.');
    return;
  }

  await HavenEngine.getInstance(canvas);
  const sm = SceneManager.getInstance();

  sm.register('login', createLoginScene);
  sm.register('lobby', createLobbyScene);
  sm.register('room', createRoomScene);

  // Avatar customizer (lazy init on first open)
  let customizer: AvatarCustomizer | null = null;

  document.getElementById('btn-avatar')?.addEventListener('click', () => {
    if (!customizer) {
      customizer = new AvatarCustomizer(authService.user?.avatar, (savedData) => {
        authService.updateAvatar(savedData);
      });
    }
    customizer.open();
  });

  // ── In-game navigation buttons ──────────────────────────────────────────
  // Fast travel to Haven Park
  document.getElementById('btn-park')?.addEventListener('click', () => {
    sm.switchTo('room', { roomId: 'room-park' }).catch(console.error);
  });

  // Return to personal loft
  document.getElementById('btn-my-loft')?.addEventListener('click', () => {
    const loftId = authService.user?.personalRoom?.id;
    if (loftId) {
      sm.switchTo('room', { roomId: loftId }).catch(console.error);
    }
  });

  // Open travel / lofts directory
  document.getElementById('btn-browse-lofts')?.addEventListener('click', () => {
    sm.switchTo('lobby').catch(console.error);
  });

  // Logout handler
  const handleLogout = () => {
    authService.logout();
    sm.switchTo('login').catch(console.error);
    customizer = null;
  };

  document.getElementById('btn-nav-logout')?.addEventListener('click', handleLogout);

  // ── Initial scene routing based on auth ──────────────────────────────────
  try {
    const user = await authService.me();
    if (user) {
      const loftId = user.personalRoom?.id;
      if (loftId) {
        await sm.switchTo('room', { roomId: loftId });
      } else {
        await sm.switchTo('lobby');
      }
    } else {
      await sm.switchTo('login');
    }
  } catch {
    await sm.switchTo('login');
  }
});
