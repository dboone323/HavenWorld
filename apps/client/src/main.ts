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
import { MarketplacePanel } from './ui/MarketplacePanel';
import { ClubPanel } from './ui/ClubPanel';
import { LeaderboardPanel } from './ui/LeaderboardPanel';
import { DoorbellPrompt } from './ui/DoorbellPrompt';
import { TutorialOverlay } from './ui/TutorialOverlay';
import { FeedbackPanel } from './ui/FeedbackPanel';
import { MailboxPanel } from './ui/MailboxPanel';
import { PassportModal } from './passport/PassportModal';
import { PizzaScene } from './minigame/PizzaScene';
import { authService } from './services/auth';
import { socketService } from './services/socket';
import { DailyLoginModal } from './ui/DailyLoginModal';
import { initPwa } from './ui/InstallPrompt';
import { ConnectionBanner } from './ui/ConnectionBanner';
import {
  showWebGLUnsupported,
  showContextLostOverlay,
  hideContextLostOverlay,
} from './ui/WebGLError';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { showToast } from './ui/ToastNotification';
import { SERVER_URL } from './config';
import { AvatarContextMenu } from './ui/AvatarContextMenu';
import { AccessibilityManager } from './ui/AccessibilityManager';
import { StreamerModeManager } from './ui/StreamerModeManager';
import './style.css';

// ── Handle Email Verification Token redirect ──────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const verifyToken = urlParams.get('token');
if (verifyToken) {
  window.location.href = `${SERVER_URL}/api/auth/verify?token=${verifyToken}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Apply saved Accessibility settings (UI scale, colorblind filter, dyslexia font)
  AccessibilityManager.getInstance().applyToDOM();

  // Listen for Streamer Mode toggles to mask/unmask currency displays
  window.addEventListener('haven:streamer-mode', () => {
    const coinEl = document.getElementById('coin-amount');
    const gemEl = document.getElementById('gem-amount');
    if (coinEl) {
      const rawCoins = coinEl.dataset.rawCoins || coinEl.textContent || '0';
      coinEl.dataset.rawCoins = rawCoins;
      coinEl.textContent = StreamerModeManager.maskSensitiveText(rawCoins);
    }
    if (gemEl) {
      const rawGems = gemEl.dataset.rawGems || gemEl.textContent || '0';
      gemEl.dataset.rawGems = rawGems;
      gemEl.textContent = StreamerModeManager.maskSensitiveText(rawGems);
    }
  });

  // Login UI HTML form setup
  mountLoginUI();

  // PWA: register the service worker and offer the install prompt (Part 9A §2)
  initPwa();

  // Connection banner: surfaces socket reconnect attempts / failures.
  // Must exist before any socket activity (it listens for `socket:status`).
  new ConnectionBanner();

  // WebGL context loss: show the "graphics paused" overlay until the context
  // is restored (dispatched from HavenEngine via the Engine observables).
  window.addEventListener('haven:webgl-context-lost', showContextLostOverlay);
  window.addEventListener('haven:webgl-context-restored', hideContextLostOverlay);

  // Get Canvas and initialize Babylon Engine
  const canvas = document.getElementById('haven-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[HavenWorld] Canvas element #haven-canvas not found.');
    return;
  }

  let haven: HavenEngine;
  try {
    haven = await HavenEngine.getInstance(canvas);
  } catch (err) {
    // WebGL unsupported (or engine init failed): explain it instead of a
    // frozen canvas. HavenEngine throws a clear message for missing WebGL.
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[HavenWorld] Failed to initialize the 3D engine:', reason);
    showWebGLUnsupported(reason);
    return;
  }
  const sm = SceneManager.getInstance();

  (window as any).__havenEngine = haven;
  (window as any).__havenSceneManager = sm;
  (window as any).__havenAuthService = authService;
  (window as any).__havenSocket = socketService;
  (window as any).__havenAvatarContextMenu = AvatarContextMenu;

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

  document.getElementById('btn-marketplace')?.addEventListener('click', () => {
    MarketplacePanel.open().catch(console.error);
  });

  document.getElementById('btn-clubs')?.addEventListener('click', () => {
    ClubPanel.open().catch(console.error);
  });

  document.getElementById('btn-leaderboard')?.addEventListener('click', () => {
    LeaderboardPanel.open().catch(console.error);
  });

  document.getElementById('btn-tutorial')?.addEventListener('click', () => {
    TutorialOverlay.open().catch(console.error);
  });

  document.getElementById('btn-feedback')?.addEventListener('click', () => {
    FeedbackPanel.show();
  });

  document.getElementById('btn-mailbox')?.addEventListener('click', () => {
    MailboxPanel.show();
  });

  // §3d — first-run onboarding nudge (once per session, dismissible)
  window.setTimeout(() => { TutorialOverlay.maybeAutoOpen().catch(console.error); }, 4000);
  window.addEventListener('auth:login', () => {
    window.setTimeout(() => { TutorialOverlay.maybeAutoOpen().catch(console.error); }, 1500);
  });

  // §3f — private loft rejected on join: offer the doorbell instead of a dead end
  socketService.on<{ code?: string; message?: string; roomId?: string }>(
    SOCKET_EVENTS.AUTH_ERROR,
    (err) => {
      if (err?.code === 'FORBIDDEN_PRIVATE_LOFT' && err.roomId) {
        DoorbellPrompt.show(err.roomId);
      }
    }
  );

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
    DailyLoginModal.tryShow(true).catch(console.error);
  });

  document.getElementById('btn-toggle-chat')?.addEventListener('click', () => {
    document.getElementById('chat-panel')?.classList.toggle('hidden');
  });

  document.getElementById('btn-toggle-dm')?.addEventListener('click', async () => {
    const { DirectMessagePanel } = await import('./ui/DirectMessagePanel');
    const panel = DirectMessagePanel.getInstance() || new DirectMessagePanel();
    panel.toggle();
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

  // ── Phase 3B: World-wide notifications (scene-independent) ─────────────────
  // Global events / server alerts arrive as SERVER_ALERT broadcasts.
  socketService.on<{
    type?: string; title?: string; message?: string; description?: string; multiplier?: number;
  }>(SOCKET_EVENTS.SERVER_ALERT, (alert) => {
    const body = alert.description || alert.message || '';
    const mult = typeof alert.multiplier === 'number' && alert.multiplier > 1
      ? ` (x${alert.multiplier})`
      : '';
    showToast({
      icon: '📢',
      title: alert.title || 'Server Alert',
      subtitle: `${body}${mult}`,
      durationMs: 6000,
    });
  });

  socketService.on<{ senderId?: string; message?: string; itemId?: string }>(
    SOCKET_EVENTS.PARCEL_ARRIVED,
    (p) => {
      showToast({
        icon: '📦',
        title: 'A parcel has arrived!',
        subtitle: p.message || (p.itemId ? `Contains: ${p.itemId}` : 'Check your inventory'),
      });
    }
  );

  socketService.on<{ secretName?: string; roomId?: string }>(
    SOCKET_EVENTS.SECRET_ROOM_DISCOVERED,
    (s) => {
      showToast({
        icon: '🗝️',
        title: 'Secret Room Discovered!',
        subtitle: s.secretName || 'A hidden door just opened somewhere…',
        durationMs: 6000,
      });
    }
  );

  socketService.on<{ nodeName?: string; material?: string; quantity?: number }>(
    SOCKET_EVENTS.GATHERING_RESULT,
    (g) => {
      showToast({
        icon: '🌿',
        title: `Gathered from ${g.nodeName || 'a node'}`,
        subtitle: `+${g.quantity ?? 1} ${g.material ?? 'materials'}`,
        durationMs: 3000,
      });
    }
  );

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
