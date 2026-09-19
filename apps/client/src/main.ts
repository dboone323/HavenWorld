import { HavenEngine } from './engine/HavenEngine';
import { SceneManager } from './engine/SceneManager';
import { createLoginScene } from './scenes/LoginScene';
import { createLobbyScene } from './scenes/LobbyScene';
import { createRoomScene } from './scenes/RoomScene';
import { mountLoginUI } from './ui/loginUI';
import { AvatarCustomizer } from './ui/AvatarCustomizer';
import { EmoteWheel } from './ui/EmoteWheel';
import { QuestHUD } from './ui/QuestHUD';
import { ShopModal } from './ui/ShopModal';
import { PassportModal } from './passport/PassportModal';
import { PizzaScene } from './minigame/PizzaScene';
import { authService } from './services/auth';
import { socketService } from './services/socket';
import { DailyLoginModal } from './ui/DailyLoginModal';
import { initPwa } from './ui/InstallPrompt';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { SERVER_URL } from './config';
import './style.css';

// ── Handle Email Verification Token redirect ──────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const verifyToken = urlParams.get('token');
if (verifyToken) {
  window.location.href = `${SERVER_URL}/api/auth/verify?token=${verifyToken}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Login UI HTML form setup
  mountLoginUI();

  // PWA: register the service worker and offer the install prompt (Part 9A §2)
  initPwa();

  // Get Canvas and initialize Babylon Engine
  const canvas = document.getElementById('haven-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[HavenWorld] Canvas element #haven-canvas not found.');
    return;
  }

  const haven = await HavenEngine.getInstance(canvas);
  const sm = SceneManager.getInstance();

  (window as any).__havenEngine = haven;
  (window as any).__havenSceneManager = sm;
  (window as any).__havenAuthService = authService;
  (window as any).__havenSocket = socketService;

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

  // Phase 3 persistent UI controllers
  new EmoteWheel();
  new QuestHUD();
  const shopModal = new ShopModal();
  const passportModal = new PassportModal();
  const pizzaScene = new PizzaScene();

  document.getElementById('btn-shop')?.addEventListener('click', () => {
    shopModal.open().catch(console.error);
  });

  document.getElementById('btn-passport')?.addEventListener('click', () => {
    passportModal.open().catch(console.error);
  });

  document.getElementById('btn-pizza')?.addEventListener('click', () => {
    pizzaScene.open();
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

  // ── MegaPlanet / YoWorld Floating Dock & Quick Actions ────────────────────
  document.getElementById('btn-quick-shop-coins')?.addEventListener('click', () => {
    shopModal.open().catch(console.error);
  });

  document.getElementById('btn-quick-shop-gems')?.addEventListener('click', () => {
    shopModal.open().catch(console.error);
  });

  document.getElementById('btn-daily-gift')?.addEventListener('click', () => {
    DailyLoginModal.tryShow().catch(console.error);
  });

  document.getElementById('btn-toggle-chat')?.addEventListener('click', () => {
    document.getElementById('chat-panel')?.classList.toggle('hidden');
  });

  document.getElementById('chk-room-lock')?.addEventListener('change', (e) => {
    const isLocked = (e.target as HTMLInputElement).checked;
    const roomId = (window as any).__havenRoomId;
    if (roomId) {
      socketService.emit(SOCKET_EVENTS.SET_ROOM_PRIVACY, {
        roomId,
        mode: isLocked ? 'LOCKED' : 'PUBLIC',
      });
    }
  });

  document.getElementById('btn-quick-mood')?.addEventListener('click', () => {
    document.getElementById('btn-loft-settings')?.click();
  });

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
