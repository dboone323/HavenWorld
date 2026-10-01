import {
  Scene,
  ArcRotateCamera,
  Camera,
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  PointerEventTypes,
  ParticleSystem,
  DynamicTexture,
} from '@babylonjs/core';
import { SOCKET_EVENTS, type PlayerState, type ChatMessage, type MoodId } from '@havenworld/shared';
import { HavenEngine } from '../engine/HavenEngine';
import { SceneManager } from '../engine/SceneManager';
import { RoomLoader } from '../world/RoomLoader';
import { createPlaceholderRoom } from '../world/PlaceholderRoom';
import { buildRoomPrefab } from '../world/RoomPrefabs';
import { AvatarController } from '../world/AvatarController';
import { RemoteAvatar } from '../world/RemoteAvatar';
import { FurnitureManager } from '../world/FurnitureManager';
import { RoomEditor } from '../world/RoomEditor';
import { FishingController } from '../fishing/FishingController';
import { MoodSystem } from '../rooms/MoodSystem';
import { audioEngine } from '../audio/AudioEngine';
import { GuestbookPanel } from '../ui/GuestbookPanel';
import { ArcadeModal } from '../ui/ArcadeModal';
import { BulletinModal } from '../ui/BulletinModal';
import { JukeboxModal } from '../ui/JukeboxModal';
import { NpcDialoguePanel } from '../ui/NpcDialoguePanel';
import { LoftShopModal } from '../ui/LoftShopModal';
import { buildPublicSpaceProps, buildLoftProps } from '../world/PublicSpaceProps';
import { InputController } from '../engine/InputController';
import { ChatOverlay } from '../ui/ChatOverlay';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';
import { API_URL, SERVER_URL, assetUrl } from '../config';
import { DailyLoginModal } from '../ui/DailyLoginModal';
import { LoftSettingsPanel } from '../ui/LoftSettingsPanel';
import { showToast, clearToasts } from '../ui/ToastNotification';
import { AvatarContextMenu } from '../ui/AvatarContextMenu';
import { PlayersListModal, type RoomOccupant } from '../ui/PlayersListModal';
import { PetController } from '../pets/PetController';
import { PetManagementPanel } from '../ui/PetManagementPanel';
import { WorkshopPanel } from '../ui/WorkshopPanel';
import { GalleryPanel } from '../gallery/GalleryPanel';
import { DirectMessagePanel } from '../ui/DirectMessagePanel';
import { TradeModal } from '../ui/TradeModal';
import { applyRoomSurfaces } from '../world/SurfaceManager';
import { InWorldSpeechBubbles } from '../ui/InWorldSpeechBubbles';
import { SmoothCamera } from '../world/SmoothCamera';
import { MinimapRadar } from '../ui/MinimapRadar';
import { IdleStateManager } from '../engine/IdleStateManager';
import { CollaborativeWhiteboard } from '../ui/CollaborativeWhiteboard';
import { StreamerModeManager } from '../ui/StreamerModeManager';
import { escapeHtml } from '../utils/escapeHtml';

export async function createRoomScene(
  haven: HavenEngine,
  data?: { roomId?: string; isVisiting?: boolean; visitedHostName?: string }
): Promise<Scene> {
  const scene = new Scene(haven.engine);
  // Transparent clearColor allows the atmospheric navy/midnight CSS viewport gradient to blend seamlessly
  scene.clearColor = new Color4(0.06, 0.08, 0.11, 0.0);
  const unsubs: Array<() => void> = [];

  // Instantiate TradeModal and register to window for trade socket events
  const tradeModal = new TradeModal();
  (window as unknown as Record<string, unknown>).__havenTradeModal = tradeModal;

  const roomId = data?.roomId || authService.user?.personalRoom?.id || 'room-park';
  (window as unknown as Record<string, string>).__havenRoomId = roomId;
  (window as unknown as Record<string, unknown>).__havenActiveScene = scene;

  // ── Show HUD & Game Container ─────────────────────────────────────────────
  document.getElementById('game-container')?.classList.remove('hidden');
  haven.engine.resize();

  document.getElementById('room-nav')?.classList.remove('hidden');
  document.getElementById('room-info-pill')?.classList.remove('hidden');
  document.getElementById('player-card')?.classList.remove('hidden');
  document.getElementById('chat-panel')?.classList.remove('hidden');
  document.getElementById('quest-hud')?.classList.remove('hidden');
  document.getElementById('lobby-panel')?.classList.add('hidden');
  document.getElementById('login-panel')?.classList.add('hidden');

  const usernameEl = document.querySelector('#player-card .player-card__username');
  if (usernameEl && authService.user) {
    usernameEl.textContent = authService.user.username;
  }

  // Populate Room Info Pill (MegaPlanet style)
  const roomNameEl = document.getElementById('room-name-display');
  const roomTypeBadge = document.getElementById('room-badge-type');
  const isOwner = authService.user?.personalRoom?.id === roomId;
  if (roomNameEl) {
    if (roomId === 'room-park') {
      roomNameEl.textContent = '🌳 Haven Park & Plaza';
      if (roomTypeBadge) roomTypeBadge.textContent = 'Public Park';
    } else {
      const ownerName = authService.user?.username || 'Citizen';
      roomNameEl.textContent = isOwner ? `${ownerName}'s Sanctuary Loft` : 'Community Loft';
      if (roomTypeBadge) roomTypeBadge.textContent = isOwner ? 'Personal Pad' : 'Guest Pad';
    }
  }

  // Room Controls Card (owner only)
  const roomControlsCard = document.getElementById('room-controls-card');
  if (roomControlsCard) {
    if (isOwner) {
      roomControlsCard.classList.remove('hidden');
    } else {
      roomControlsCard.classList.add('hidden');
    }
  }

  // ── True Isometric Orthographic Camera ────────────────────────────────────
  const camera = new ArcRotateCamera(
    'isometricCam',
    -Math.PI / 4, // 45 deg angle looking at corner
    Math.atan(Math.SQRT2), // 54.7356 deg true isometric pitch (35.26 deg elevation)
    25,           // radius
    new Vector3(0, 1.0, 0),
    scene
  );
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

  const updateOrtho = () => {
    const aspect = haven.canvas.width / haven.canvas.height;
    // On narrow / mobile portrait screens (aspect < 1.0), expand vertical ortho size so loft is never clipped horizontally
    const baseOrtho = 8.5;
    const orthoSize = aspect < 1.0 ? baseOrtho / aspect : baseOrtho;
    camera.orthoLeft = -orthoSize * aspect;
    camera.orthoRight = orthoSize * aspect;
    camera.orthoTop = orthoSize;
    camera.orthoBottom = -orthoSize;
  };
  updateOrtho();
  window.addEventListener('resize', updateOrtho);
  unsubs.push(() => window.removeEventListener('resize', updateOrtho));

  camera.lowerRadiusLimit = 15;
  camera.upperRadiusLimit = 35;
  camera.lowerBetaLimit = Math.atan(Math.SQRT2);
  camera.upperBetaLimit = Math.atan(Math.SQRT2);
  camera.lowerAlphaLimit = -Math.PI / 4;
  camera.upperAlphaLimit = -Math.PI / 4;
  camera.attachControl(haven.canvas, true);

  // Lock camera rotation: remove pointer rotation & keyboard move inputs
  camera.inputs.removeByType('ArcRotateCameraPointersInput');
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

  // ── Lighting & Shadows (MegaPlanet warm studio lighting) ──────────────────
  const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
  ambientLight.intensity = 0.85;
  ambientLight.diffuse = new Color3(1.0, 0.98, 0.95);
  ambientLight.groundColor = new Color3(0.55, 0.55, 0.60);

  const sunLight = new DirectionalLight('sunLight', new Vector3(-1, -2, -1), scene);
  sunLight.position = new Vector3(15, 25, 15);
  sunLight.intensity = 0.65;

  const shadowGenerator = new ShadowGenerator(2048, sunLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 32;

    // ── Room Geometry Loading ─────────────────────────────────────────────────
  const roomLoader = new RoomLoader(scene);
  let roomMeshes: import('@babylonjs/core').AbstractMesh[] = [];
  if (RoomLoader.hasStaticGlb(roomId)) {
    const glbId = RoomLoader.resolveGlbId(roomId);
    try {
      const loadResult = await roomLoader.load(glbId);
      roomMeshes = loadResult.allMeshes || [];
    } catch (err) {
      console.warn(
        `[RoomScene] Room GLB load failed for "${roomId}" ` +
          `(tried ${assetUrl(`/assets/rooms/${glbId}.glb`)}): ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          'Falling back to procedural prefab.'
      );
    }
  }
  if (roomMeshes.length === 0) {
    roomMeshes = buildRoomPrefab(scene, roomId) || createPlaceholderRoom(scene);
  }

  // Phase 3 — interactive props (arcade, corkboard, jukebox, NPCs, gathering
  // nodes) for the public spaces, whether the room came from GLB or prefab.
  const upvoteBtn = document.getElementById('btn-loft-upvote');
  upvoteBtn?.classList.add('hidden');
  let onUpvoteClick: (() => void) | null = null;
  if (['room-town-square', 'room-park', 'room-cafe'].includes(roomId)) {
    roomMeshes.push(...buildPublicSpaceProps(scene, roomId));
  } else if (!roomId.startsWith('room-')) {
    roomMeshes.push(...buildLoftProps(scene));

    // §3k — "Love this loft" upvote for visiting guests (not on your own loft)
    if (upvoteBtn && !isOwner) {
      upvoteBtn.classList.remove('hidden');
      onUpvoteClick = async () => {
        try {
          const token = authService.token || (await authService.getToken()) || '';
          const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/upvote`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });
          if (res.ok) {
            showToast({ icon: '👍', title: 'Loved this loft!', subtitle: 'Thanks for spreading the joy' });
            upvoteBtn.classList.add('hidden');
          } else {
            const data = await res.json().catch(() => ({ error: 'Already upvoted recently' }));
            showToast({ icon: '⚠️', title: 'Loft rating', subtitle: data.error ?? 'Failed' });
          }
        } catch {
          showToast({ icon: '⚠️', title: 'Loft rating', subtitle: 'Network error' });
        }
      };
      upvoteBtn.addEventListener('click', onUpvoteClick);
    }
  }

  // Setup shadow receivers
  for (const m of roomMeshes) {
    if (m.metadata?.walkable || m.name === 'placeholder_ground' || m.name.startsWith('Walkable_')) {
      m.receiveShadows = true;
    }
  }

  // ── Room Custom Surfaces (Floors & Walls) ─────────────────────────────────
  if (roomId !== 'room-park' && roomId !== 'room-town-square' && roomId !== 'room-cafe' && roomId !== 'room-lobby') {
    authService.getToken().then((tokenVal) => {
      if (!tokenVal) return;
      fetch(`${API_URL}/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${tokenVal}` },
      })
        .then((r) => r.json())
        .then((roomData) => {
          if (roomData && (roomData.floorTexture || roomData.wallTexture)) {
            applyRoomSurfaces(scene, roomData.floorTexture, roomData.wallTexture);
          }
        })
        .catch(() => { /* non-critical */ });
    });
  }

  unsubs.push(
    socketService.on<{ roomId: string; floorTexture?: string; wallTexture?: string }>(
      'room:surfaces_updated' as any,
      (data) => {
        if (data?.roomId === roomId) {
          applyRoomSurfaces(scene, data.floorTexture, data.wallTexture);
        }
      }
    )
  );

  // ── Local Avatar ──────────────────────────────────────────────────────────
  const user = authService.user || {
    id: 'anon',
    username: 'Guest',
    avatar: {},
  };

  const avatarController = new AvatarController(scene, {
    id: user.id,
    username: user.username,
    avatarData: user.avatar as Record<string, unknown>,
  });
  avatarController.roomId = roomId;
  await avatarController.init();
  (window as unknown as Record<string, unknown>).__havenAvatarController = avatarController;
  (window as unknown as Record<string, unknown>).__havenGetAvatarPosition = () => {
    if (!avatarController || !avatarController.rootMesh) return null;
    return {
      x: avatarController.rootMesh.position.x,
      y: avatarController.rootMesh.position.y,
      z: avatarController.rootMesh.position.z,
      rotY: avatarController.rootMesh.rotation.y,
      isMoving: Boolean(avatarController.isMoving),
    };
  };

  // ── SmoothCamera Follow (Spring-damper with deadzone) ────────────────────
  const isPublicRoom = roomId === 'room-lobby' || roomId === 'room-park' || roomId === 'room-town-square' || roomId === 'room-cafe';
  const smoothCamera = new SmoothCamera({ x: 0, y: 0 }, 0.08, 0.05);

  // ── Minimap Radar HUD ─────────────────────────────────────────────────────
  const minimapRadar = new MinimapRadar(30, 30, 110);
  let radarCanvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    radarCanvas = document.getElementById('haven-minimap-radar') as HTMLCanvasElement | null;
    if (!radarCanvas) {
      radarCanvas = document.createElement('canvas');
      radarCanvas.id = 'haven-minimap-radar';
      radarCanvas.width = minimapRadar.radarSize;
      radarCanvas.height = minimapRadar.radarSize;
      radarCanvas.style.cssText = `
        position: fixed;
        top: 68px;
        right: 76px;
        width: ${minimapRadar.radarSize}px;
        height: ${minimapRadar.radarSize}px;
        background: rgba(15, 23, 42, 0.82);
        border: 1.5px solid rgba(78, 205, 196, 0.55);
        border-radius: 50%;
        z-index: 8500;
        pointer-events: none;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      `;
      document.body.appendChild(radarCanvas);
    }
  }

  // ── Idle / AFK State Manager ──────────────────────────────────────────────
  const idleManager = new IdleStateManager(60_000, 300_000);
  const onUserActivity = () => idleManager.reportActivity();
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onUserActivity, { passive: true });
    window.addEventListener('keydown', onUserActivity, { passive: true });
  }
  unsubs.push(
    idleManager.subscribe((state) => {
      const isIdleOrAfk = state === 'IDLE' || state === 'AFK';
      avatarController.chibiBillboard?.setDimmed(isIdleOrAfk);
      if (state === 'AFK') {
        InWorldSpeechBubbles.getInstance().showBubble(user.id, user.username, '💤 AFK');
      }
    })
  );

  // ── 3D In-World Speech Bubbles (MiPlanet standard) ───────────────────────
  const speechBubbles = InWorldSpeechBubbles.getInstance();
  speechBubbles.attachScene(scene);
  speechBubbles.registerLocalAvatar(() => {
    return avatarController.rootMesh ? avatarController.rootMesh.getAbsolutePosition() : null;
  });

  // ── Remote Avatars ────────────────────────────────────────────────────────
  const remoteAvatars = new Map<string, RemoteAvatar>();

  const cameraFollowCallback = () => {
    if (isPublicRoom && avatarController.rootMesh) {
      smoothCamera.setTarget({
        x: avatarController.rootMesh.position.x,
        y: avatarController.rootMesh.position.z,
      });
      const nextPos = smoothCamera.update(1.0);
      camera.target.x = nextPos.x;
      camera.target.z = nextPos.y;
    }

    idleManager.checkInactivity();

    if (radarCanvas) {
      const ctx = radarCanvas.getContext('2d');
      if (ctx) {
        const size = minimapRadar.radarSize;
        ctx.clearRect(0, 0, size, size);
        // Subtle radar crosshairs
        ctx.strokeStyle = 'rgba(78, 205, 196, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(size / 2, 0);
        ctx.lineTo(size / 2, size);
        ctx.moveTo(0, size / 2);
        ctx.lineTo(size, size / 2);
        ctx.stroke();

        // Local player blip
        if (avatarController.rootMesh) {
          const blip = minimapRadar.createBlip(
            user.id,
            'local_player',
            avatarController.rootMesh.position.x + 15,
            avatarController.rootMesh.position.z + 15
          );
          const { px, py } = minimapRadar.getPixelPosition(blip.x, blip.y);
          ctx.fillStyle = blip.color;
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Remote player blips
        for (const [pid, remote] of remoteAvatars.entries()) {
          const rPos = remote.rootMesh.position;
          const blip = minimapRadar.createBlip(pid, 'other_player', rPos.x + 15, rPos.z + 15);
          const { px, py } = minimapRadar.getPixelPosition(blip.x, blip.y);
          ctx.fillStyle = blip.color;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };
  scene.registerBeforeRender(cameraFollowCallback);

  function addOrUpdateRemoteAvatar(p: PlayerState) {
    if (!p || p.id === user.id) return;

    let remote = remoteAvatars.get(p.id);
    if (!remote) {
      remote = new RemoteAvatar(
        scene,
        {
          id: p.id,
          username: p.username,
          avatarData: p.avatar as Record<string, unknown>,
        },
        {
          x: p.x ?? 0,
          y: p.y ?? 0,
          z: p.z ?? 0,
          rotY: p.rotY ?? 0,
        }
      );
      remoteAvatars.set(p.id, remote);
      speechBubbles.registerRemoteAvatar(p.id, () => {
        return remote && remote.rootMesh ? remote.rootMesh.getAbsolutePosition() : null;
      });
    } else {
      remote.updatePosition(p.x ?? 0, p.y ?? 0, p.z ?? 0, p.rotY ?? 0);
    }
    updateOccupantsCount();
  }

  // ── Room Occupants Badge & Modal ──────────────────────────────────────────
  const updateOccupantsCount = () => {
    const badge = document.getElementById('room-badge-occupants');
    const total = remoteAvatars.size + 1;
    if (badge) {
      badge.textContent = `👥 ${total}`;
      badge.style.cursor = 'pointer';
      badge.title = 'Click to view players in this room';
    }
  };

  const badgeOccupants = document.getElementById('room-badge-occupants');
  const onBadgeOccupantsClick = () => {
    const occupants: RoomOccupant[] = [
      {
        id: user.id,
        username: user.username,
        isSelf: true,
        position: avatarController.rootMesh
          ? {
              x: avatarController.rootMesh.position.x,
              y: avatarController.rootMesh.position.y,
              z: avatarController.rootMesh.position.z,
            }
          : undefined,
      },
    ];
    for (const [id, remote] of remoteAvatars.entries()) {
      occupants.push({
        id,
        username: remote.username,
        isSelf: false,
        position: remote.rootMesh
          ? {
              x: remote.rootMesh.position.x,
              y: remote.rootMesh.position.y,
              z: remote.rootMesh.position.z,
            }
          : undefined,
      });
    }
    PlayersListModal.show(occupants, (targetId) => {
      const target = remoteAvatars.get(targetId);
      if (target?.rootMesh) {
        avatarController.moveTo(target.rootMesh.position.clone());
        showToast({ icon: '🏃', title: 'Following', subtitle: `Walking to ${target.username}` });
      }
    });
  };
  badgeOccupants?.addEventListener('click', onBadgeOccupantsClick);
  updateOccupantsCount();

  // ── Visiting Room Banner ──────────────────────────────────────────────────
  let visitingBanner: HTMLElement | null = null;
  if (data?.isVisiting) {
    const host = escapeHtml(data.visitedHostName || 'Player');
    visitingBanner = document.createElement('div');
    visitingBanner.id = 'visiting-banner';
    visitingBanner.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(26, 26, 46, 0.94);
      border: 1.5px solid #4ecdc4;
      border-radius: 20px;
      padding: 6px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      z-index: 9998;
      color: #fff;
      font-family: Calibri, sans-serif;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    `;
    visitingBanner.innerHTML = `
      <span style="font-size: 0.9rem; font-weight: 500;">🏠 Visiting <strong style="color: #4ecdc4;">${host}</strong>'s Loft</span>
      <button id="btn-visiting-return" style="background: #4ecdc4; color: #0d0d1a; border: none; border-radius: 12px; padding: 4px 12px; font-weight: bold; cursor: pointer; font-size: 0.8rem;">Return Home</button>
    `;
    document.body.appendChild(visitingBanner);
    visitingBanner.querySelector('#btn-visiting-return')?.addEventListener('click', () => {
      const homeLoftId = authService.user?.personalRoom?.id;
      if (homeLoftId) {
        SceneManager.getInstance().switchTo('room', { roomId: homeLoftId }).catch(console.error);
      } else {
        SceneManager.getInstance().switchTo('lobby').catch(console.error);
      }
    });
  }

  // ── Furniture & Room Decorator ───────────────────────────────────────────
  const furnitureManager = new FurnitureManager(scene, user.id);
  (window as unknown as Record<string, unknown>).__havenFurnitureManager = furnitureManager;
  await furnitureManager.loadRoomFurniture(roomId);

  // Wire A* obstacle footprints from placed furniture into AvatarController
  avatarController.setObstacleProvider(() => {
    const obstacles = new Set<string>();
    const halfSpan = 15;
    const cellSize = 0.5;
    const gridSize = Math.round((halfSpan * 2) / cellSize);
    const toGrid = (val: number) =>
      Math.max(0, Math.min(gridSize - 1, Math.round((val + halfSpan) / cellSize)));

    for (const [, pf] of furnitureManager.allPlaced) {
      if (!pf.mesh || pf.itemId.includes('rug')) continue;
      pf.mesh.computeWorldMatrix(true);
      const bb = pf.mesh.getBoundingInfo().boundingBox;
      const minX = toGrid(bb.minimumWorld.x);
      const maxX = toGrid(bb.maximumWorld.x);
      const minZ = toGrid(bb.minimumWorld.z);
      const maxZ = toGrid(bb.maximumWorld.z);
      for (let gx = minX; gx <= maxX; gx++) {
        for (let gz = minZ; gz <= maxZ; gz++) {
          obstacles.add(`${gx},${gz}`);
        }
      }
    }
    return obstacles;
  });

  const btnDecorate = document.getElementById('btn-decorate');
  let roomEditor: RoomEditor | null = null;
  let inputController: InputController | null = null;

  const toggleDecorate = () => {
    if (!roomEditor) return;
    if (roomEditor.inEditMode) {
      roomEditor.exitEditMode();
    } else {
      roomEditor.enterEditMode();
    }
  };

  if (isOwner && btnDecorate) {
    btnDecorate.classList.remove('hidden');
    btnDecorate.innerHTML = '<span class="dock-icon">🛋️</span>';
    btnDecorate.setAttribute('data-tooltip', 'Decorate Loft');
    btnDecorate.classList.remove('btn--teal');
    roomEditor = new RoomEditor(scene, furnitureManager, roomId, 0, (inEditMode) => {
      inputController?.setEnabled(!inEditMode);
      if (btnDecorate) {
        if (inEditMode) {
          btnDecorate.innerHTML = '<span class="dock-icon">💾</span>';
          btnDecorate.setAttribute('data-tooltip', 'Finish Decorating');
          btnDecorate.classList.add('btn--teal');
        } else {
          btnDecorate.innerHTML = '<span class="dock-icon">🛋️</span>';
          btnDecorate.setAttribute('data-tooltip', 'Decorate Loft');
          btnDecorate.classList.remove('btn--teal');
        }
      }
    });
    (window as unknown as Record<string, unknown>).__havenRoomEditor = roomEditor;
    btnDecorate.addEventListener('click', toggleDecorate);
  } else if (btnDecorate) {
    btnDecorate.classList.add('hidden');
  }

  // ── Coin Balance HUD ─────────────────────────────────────────────────────
  const coinAmount = document.getElementById('coin-amount');
  authService.getToken().then((tokenVal) => {
    if (coinAmount && tokenVal) {
      fetch(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${tokenVal}` },
      })
        .then((r) => r.json())
        .then((me) => {
          if (typeof me?.coinBalance === 'number') {
            coinAmount.dataset.rawCoins = String(me.coinBalance);
            coinAmount.textContent = StreamerModeManager.maskSensitiveText(me.coinBalance);
          }
        })
        .catch(() => { /* non-critical */ });
    }
  });

  // ── Daily Login Streak Modal ──────────────────────────────────────────────
  // Fires POST /api/users/daily-claim — shows modal only if today's reward wasn't collected yet
  DailyLoginModal.tryShow().catch(() => { /* non-critical */ });

  // ── Loft Settings Button (owner only) ────────────────────────────────────
  const btnLoftSettings = document.getElementById('btn-loft-settings');
  let loftSettings: LoftSettingsPanel | null = null;
  // Tracks the room's active mood so the settings panel always opens with the
  // current value selected. Declared here so the socket handlers below can update it.
  let currentMood: MoodId = 'day';
  // Named (not anonymous) so it can be removed on scene disposal — the button is
  // a persistent HUD element, and re-registering an anonymous listener per scene
  // stacked one settings modal per room visit.
  const loftSettingsClickHandler = () => {
    if (loftSettings) {
      loftSettings.setCurrentMood(currentMood);
      loftSettings.show();
    }
  };
  if (isOwner && btnLoftSettings) {
    btnLoftSettings.classList.remove('hidden');
    loftSettings = new LoftSettingsPanel({
      roomId,
      ownerId: user.id,
      currentMood,
      onPrivacyChange: (mode, password) => {
        socketService.emit(SOCKET_EVENTS.SET_ROOM_PRIVACY, { roomId, mode, password });
      },
      onMoodChange: (mood) => {
        socketService.emit(SOCKET_EVENTS.SET_ROOM_MOOD, { roomId, mood });
        currentMood = mood;
        moodSystem.applyMood(mood);
        loftSettings?.dismiss();
        audioEngine.playFurniturePlace();
        showToast({ icon: '🎨', title: 'Mood updated', subtitle: 'Your new room mood is live.' });
      },
    });
    btnLoftSettings.addEventListener('click', loftSettingsClickHandler);
  } else if (btnLoftSettings) {
    btnLoftSettings.classList.add('hidden');
  }

  // ── Phase 3: Fishing Dock ────────────────────────────────────────────────
  const btnFishing = document.getElementById('btn-fishing');
  const isPark = roomId === 'room-park';
  const fishingController = new FishingController(scene);

  const startFishingHandler = () => {
    fishingController.startFishing(roomId);
  };

  if (isPark && btnFishing) {
    btnFishing.classList.remove('hidden');
    btnFishing.addEventListener('click', startFishingHandler);
  } else if (btnFishing) {
    btnFishing.classList.add('hidden');
  }

  // ── Pet Companion UI & Controller ────────────────────────────────────────
  const btnPets = document.getElementById('btn-pets');
  const petHandler = () => {
    PetManagementPanel.show();
  };
  if (btnPets) {
    btnPets.addEventListener('click', petHandler);
  }

  // ── Workshop & Gallery Navigation Buttons (#btn-clubs is handled in main.ts) ──
  const btnWorkshop = document.getElementById('btn-workshop');
  const workshopHandler = () => WorkshopPanel.show();
  btnWorkshop?.addEventListener('click', workshopHandler);

  const btnGallery = document.getElementById('btn-gallery');
  const galleryHandler = () => GalleryPanel.show();
  btnGallery?.addEventListener('click', galleryHandler);

  // ── Pet Management — spawn existing pets on room entry + live adoptions ────
  const localPets = new Map<string, PetController>();

  async function spawnLocalPets(): Promise<void> {
    try {
      const token = await authService.getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/users/me/pets`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) return;
      const pets = await res.json() as Array<{
        id: string;
        name: string;
        petType: string;
        happiness: number;
        hunger: number;
      }>;
      for (const pet of pets) {
        if (localPets.has(pet.id)) continue; // already spawned
        if (avatarController.rootMesh) {
          const controller = new PetController(
            scene,
            { id: pet.id, name: pet.name, petType: pet.petType as any, happiness: pet.happiness, hunger: pet.hunger },
            avatarController.rootMesh,
          );
          localPets.set(pet.id, controller);
        }
      }
    } catch (err) {
      console.warn('[RoomScene] Could not load pets on room entry:', err);
    }
  }

  // Spawn existing pets immediately on room join
  spawnLocalPets().catch(console.warn);

  // Listen for new adoption events to spawn pet live without a page reload
  unsubs.push(
    socketService.on<{ id: string; petType: any; name: string; happiness: number; hunger: number }>(
      SOCKET_EVENTS.PET_ADOPTED,
      (pet) => {
        // Dispose previous pet with same id if any
        const existing = localPets.get(pet.id);
        if (existing) { existing.dispose(); localPets.delete(pet.id); }
        if (avatarController.rootMesh) {
          const controller = new PetController(scene, pet, avatarController.rootMesh);
          localPets.set(pet.id, controller);
        }
      }
    )
  );


  // ── Phase 3: Loft Ambient Moods ──────────────────────────────────────────
  const moodSystem = new MoodSystem(scene);

  // ── Phase 3: Procedural Footstep Audio Loop ──────────────────────────────
  let footstepTimer = 0;
  const footstepCallback = () => {
    if (avatarController.isMoving) {
      footstepTimer += scene.getEngine().getDeltaTime();
      if (footstepTimer >= 350) {
        audioEngine.playFootstep();
        footstepTimer = 0;
      }
    }
  };
  scene.registerBeforeRender(footstepCallback);

  // ── Input & Chat Controllers ──────────────────────────────────────────────
  inputController = new InputController(scene, avatarController, camera);
  const dmPanel = DirectMessagePanel.getInstance() || new DirectMessagePanel();
  dmPanel.setSpeechTrigger((senderId: string, content: string) => {
    const remote = remoteAvatars.get(senderId);
    if (remote) {
      remote.showSpeech(`✉️ ${content}`);
    }
  });

  const chatOverlay = new ChatOverlay(null, () => {
    audioEngine.playChatMessage();
  });

  // ── Interaction & Context Menu Pointer Observable ────────────────────────
  const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    const handleAvatarInteraction = (mesh: any, clientX: number, clientY: number) => {
      if (!mesh) return false;
      const meta = mesh.metadata || mesh.parent?.metadata;
      if (meta?.isRemoteAvatar && meta?.userId && meta?.username) {
        AvatarContextMenu.show({
          x: clientX,
          y: clientY,
          targetUserId: meta.userId,
          targetUsername: meta.username,
          isSelf: false,
        });
        return true;
      }
      if (meta?.isLocalAvatar && meta?.userId && meta?.username) {
        AvatarContextMenu.show({
          x: clientX,
          y: clientY,
          targetUserId: meta.userId,
          targetUsername: meta.username,
          isSelf: true,
        });
        return true;
      }
      return false;
    };

    // Right-click on meshes (POINTERDOWN with right button or POINTERTAP)
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN && pointerInfo.event.button === 2) {
      const pick = scene.pick(scene.pointerX, scene.pointerY);
      if (pick?.hit && pick.pickedMesh) {
        handleAvatarInteraction(pick.pickedMesh, pointerInfo.event.clientX, pointerInfo.event.clientY);
      }
    }

    // Left-click on interactive trigger meshes or remote avatars
    if (pointerInfo.type === PointerEventTypes.POINTERPICK) {
      const evt = pointerInfo.event as PointerEvent;
      if (evt.button === 0 || evt.button === undefined) {
        const handled = handleAvatarInteraction(
          pointerInfo.pickInfo?.pickedMesh || null,
          evt.clientX,
          evt.clientY
        );
        if (handled) return;
      }

      const meshName = pointerInfo.pickInfo?.pickedMesh?.name;
      if (!meshName) return;

      if (meshName.includes('fishing_dock') || meshName === 'fishing-dock') {
        fishingController.startFishing(roomId);
      } else if (meshName === 'door_portal' || meshName.includes('door_exit') || meshName.includes('loft_door') || meshName === 'loft-door') {
        SceneManager.getInstance().switchTo('lobby').catch(console.error);
        audioEngine.playDoorbell();
      } else if (meshName.includes('guestbook') || meshName === 'guestbook-mesh') {
        GuestbookPanel.show(roomId, { canDelete: isOwner });
      } else if (meshName.includes('tip_jar') || meshName === 'tip-jar-mesh') {
        const amount = prompt('Enter tip amount in Haven Coins:');
        if (amount && parseInt(amount, 10) > 0) {
          socketService.emit(SOCKET_EVENTS.TIP_OWNER, { roomId, amount: parseInt(amount, 10) });
        }
      } else if (meshName.includes('pizza_station') || meshName === 'pizza-station') {
        document.getElementById('btn-pizza')?.click();
      } else if (meshName.includes('tv_screen') || meshName.includes('whiteboard') || meshName.includes('menu_board')) {
        CollaborativeWhiteboard.openModal(roomId);
      } else if (meshName === 'arcade-cabinet') {
        ArcadeModal.show({
          selfId: authService.user?.id ?? '',
          selfName: authService.user?.username ?? 'You',
          players: [...remoteAvatars.values()].map((r) => ({ userId: r.userId, username: r.username })),
        });
      } else if (meshName === 'bulletin-board') {
        BulletinModal.open().catch(console.error);
      } else if (meshName === 'jukebox-machine') {
        JukeboxModal.show(roomId);
      } else if (meshName.startsWith('npc-')) {
        NpcDialoguePanel.open(meshName.slice('npc-'.length));
      } else if (meshName.startsWith('gather-')) {
        socketService.emit(SOCKET_EVENTS.GATHER_NODE, { nodeId: meshName.slice('gather-'.length) });
      } else if (meshName === 'loft-shop-register') {
        LoftShopModal.show(roomId, isOwner);
      }
    }
  });

  // ── Dev Inspector Hotkey (Cmd+I / Ctrl+I) ──────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      haven.toggleInspector();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // ── Socket Multiplayer Sync ───────────────────────────────────────────────
  socketService.connect();

  // Join room on server
  socketService.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId });

  // Phase 3B: pull the current world weather so the atmosphere applies on entry
  socketService.emit(SOCKET_EVENTS.WEATHER_GET);

  // Initial room state (players list)
  unsubs.push(
    socketService.on<{ roomId: string; players: PlayerState[]; mood?: MoodId }>(
      SOCKET_EVENTS.ROOM_STATE,
      (state) => {
        if (state && Array.isArray(state.players)) {
          for (const p of state.players) {
            addOrUpdateRemoteAvatar(p);
          }
          updateOccupantsCount();
        }
        // Apply the room's persisted mood on join
        if (state?.mood) {
          currentMood = state.mood;
          moodSystem.applyMood(state.mood);
        }
      }
    )
  );

  // Player joined
  unsubs.push(
    socketService.on<PlayerState>(SOCKET_EVENTS.ROOM_PLAYER_JOINED, (p) => {
      addOrUpdateRemoteAvatar(p);
    })
  );
  unsubs.push(
    socketService.on<any>(
      'player:join' as any,
      (p) => {
        if (!p || p.userId === user.id) return;
        addOrUpdateRemoteAvatar({
          id: p.userId,
          username: p.username,
          avatar: p.avatarData || {},
          x: p.position?.x ?? 0,
          y: p.position?.y ?? 0,
          z: p.position?.z ?? 0,
          rotY: p.position?.rotY ?? 0,
          direction: 'down',
          isMoving: false,
          roomId,
        });
      }
    )
  );

  // Player moved
  unsubs.push(
    socketService.on<{
      playerId: string;
      userId?: string;
      seq?: number;
      x: number;
      y: number;
      z?: number;
      rotY?: number;
      timestamp?: number;
    }>(SOCKET_EVENTS.PLAYER_POSITION, (pos) => {
      const pid = pos.playerId || pos.userId;
      if (!pid) return;
      if (pid === user.id) {
        if (typeof pos.seq === 'number' && avatarController.rootMesh) {
          const res = avatarController.reconciliation.reconcile(pos.seq, {
            x: pos.x,
            y: pos.z ?? 0,
          });
          if (res.reconciled) {
            avatarController.rootMesh.position.x = res.correctedPosition.x;
            avatarController.rootMesh.position.z = res.correctedPosition.y;
          }
        }
        return;
      }
      const remote = remoteAvatars.get(pid);
      if (remote) {
        remote.updatePosition(pos.x, pos.y, pos.z ?? 0, pos.rotY ?? 0, pos.timestamp);
      }
    })
  );
  unsubs.push(
    socketService.on<{
      playerId: string;
      userId?: string;
      seq?: number;
      x: number;
      y: number;
      z?: number;
      rotY?: number;
      timestamp?: number;
    }>('player:move', (pos) => {
      const pid = pos.playerId || pos.userId;
      if (!pid || pid === user.id) return;
      const remote = remoteAvatars.get(pid);
      if (remote) {
        remote.updatePosition(pos.x, pos.y, pos.z ?? 0, pos.rotY ?? 0, pos.timestamp);
      }
    })
  );

  // Player sit
  unsubs.push(
    socketService.on<{
      playerId: string;
      userId?: string;
      seatId?: string;
      x: number;
      y: number;
      z: number;
      rotY: number;
      isSitting: boolean;
      direction?: 'down' | 'up' | 'left' | 'right';
      sitFrame?: 0 | 1;
    }>(SOCKET_EVENTS.PLAYER_SIT, (data) => {
      const pid = data.playerId || data.userId;
      if (!pid || pid === user.id) return;
      const remote = remoteAvatars.get(pid);
      if (remote) {
        remote.setSitting(
          data.isSitting,
          data.x,
          data.y,
          data.z,
          data.rotY,
          data.direction ?? 'down',
          data.sitFrame ?? 0,
        );
      }
    })
  );

  // Player left
  unsubs.push(
    socketService.on<{ playerId: string }>(SOCKET_EVENTS.ROOM_PLAYER_LEFT, ({ playerId }) => {
      const remote = remoteAvatars.get(playerId);
      if (remote) {
        remote.dispose();
        remoteAvatars.delete(playerId);
        speechBubbles.unregisterRemoteAvatar(playerId);
        updateOccupantsCount();
      }
    })
  );

  // Friend status broadcasts
  unsubs.push(
    socketService.on<{ friendId: string; username: string }>(SOCKET_EVENTS.FRIEND_ONLINE, (data) => {
      if (data?.username) {
        showToast({ icon: '🟢', title: 'Friend Online', subtitle: `${data.username} is now online` });
      }
    })
  );
  unsubs.push(
    socketService.on<{ friendId: string; username: string }>(SOCKET_EVENTS.FRIEND_OFFLINE, (data) => {
      if (data?.username) {
        showToast({ icon: '⚪', title: 'Friend Offline', subtitle: `${data.username} went offline` });
      }
    })
  );

  // Furniture updated in real-time
  const onFurnitureUpdate = async (data: { roomId: string }) => {
    if (data?.roomId === roomId) {
      furnitureManager.clear();
      await furnitureManager.loadRoomFurniture(roomId);
    }
  };
  unsubs.push(socketService.on<{ roomId: string }>(SOCKET_EVENTS.ROOM_FURNITURE_UPDATED, onFurnitureUpdate));

  // Avatar customization updated in real-time
  const onAvatarUpdate = (data: { userId: string; avatarData?: any }) => {
    if (!data) return;
    if (data.userId === user.id) {
      if (data.avatarData) {
        avatarController.applyCustomization(data.avatarData);
      }
    } else {
      const remote = remoteAvatars.get(data.userId);
      if (remote && data.avatarData) {
        remote.applyCustomization(data.avatarData);
      }
    }
  };
  unsubs.push(socketService.on<{ userId: string; avatarData?: any }>(SOCKET_EVENTS.AVATAR_UPDATE, onAvatarUpdate));

  // Ambient mood changed
  unsubs.push(
    socketService.on<{ roomId: string; mood: MoodId }>(
      SOCKET_EVENTS.ROOM_MOOD_CHANGED,
      (data) => {
        if (data.roomId === roomId) {
          currentMood = data.mood;
          moodSystem.applyMood(data.mood);
        }
      }
    )
  );

  // Doorbell ring notice (for loft owner)
  unsubs.push(
    socketService.on<{ visitorId: string; visitorName: string; roomId: string }>(
      SOCKET_EVENTS.DOORBELL_RING,
      (data) => {
        if (data.roomId === roomId) {
          audioEngine.playDoorbell();
          const admit = confirm(`🔔 ${data.visitorName} is at your loft door! Admit visitor?`);
          socketService.emit(SOCKET_EVENTS.DOORBELL_DECISION, {
            roomId,
            visitorId: data.visitorId,
            admit,
          });
        }
      }
    )
  );

  // Avatar Emote received
  unsubs.push(
    socketService.on<{ userId: string; emoteId: string }>(
      SOCKET_EVENTS.AVATAR_EMOTE,
      (data) => {
        audioEngine.playPetHappy();
        const displayName = data.userId === user.id ? user.username : 'Player';
        speechBubbles.showBubble(data.userId, displayName, `✨ ${data.emoteId}`);
      }
    )
  );

  // Achievement Unlocked Toast
  unsubs.push(
    socketService.on<{ title: string; description?: string; badgeIcon?: string }>(
      SOCKET_EVENTS.ACHIEVEMENT_UNLOCKED,
      (data) => {
        showToast({
          icon: data.badgeIcon || '🏆',
          title: 'Achievement Unlocked!',
          subtitle: data.title + (data.description ? ` — ${data.description}` : ''),
        });
      }
    )
  );

  // Daily / Coins Reward Update
  unsubs.push(
    socketService.on<{ coins: number }>(
      SOCKET_EVENTS.DAILY_REWARD,
      (data) => {
        const coinAmountEl = document.getElementById('coin-amount');
        if (coinAmountEl && typeof data.coins === 'number') {
          coinAmountEl.dataset.rawCoins = String(data.coins);
          coinAmountEl.textContent = StreamerModeManager.maskSensitiveText(data.coins);
        }
      }
    )
  );

  // ── Phase 3B: World Weather Atmosphere & Jukebox ───────────────────────────
  type WeatherId = 'SUNNY' | 'RAIN' | 'AURORA' | 'SNOW';
  const WEATHER_PRESETS: Record<WeatherId, { fog: Color3; density: number; ambient: number; icon: string }> = {
    SUNNY:  { fog: new Color3(0.85, 0.90, 0.96), density: 0.002,          ambient: 0.95, icon: '☀️' },
    RAIN:   { fog: new Color3(0.42, 0.47, 0.56), density: 0.014,          ambient: 0.55, icon: '🌧️' },
    SNOW:   { fog: new Color3(0.92, 0.94, 0.99), density: 0.010,          ambient: 0.80, icon: '❄️' },
    AURORA: { fog: new Color3(0.14, 0.10, 0.34), density: 0.005,          ambient: 0.65, icon: '🌌' },
  };
  let lastWeather: WeatherId | null = null;

  // §3j — precipitation particles for outdoor spaces (rain streaks / drifting snow)
  let weatherParticles: ParticleSystem | null = null;
  let weatherDotTexture: DynamicTexture | null = null;
  const getWeatherDotTexture = (): DynamicTexture => {
    if (weatherDotTexture) return weatherDotTexture;
    weatherDotTexture = new DynamicTexture('weather-dot', { width: 32, height: 32 }, scene, false);
    const ctx = weatherDotTexture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fill();
    weatherDotTexture.update(false);
    return weatherDotTexture;
  };

  const applyWeather = (weather: WeatherId, intensity: number): void => {
    const preset = WEATHER_PRESETS[weather];
    if (!preset) return;
    const i = Math.max(0, Math.min(1, intensity));
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = preset.fog;
    scene.fogDensity = weather === 'SUNNY' ? preset.density : preset.density * (0.5 + i);
    ambientLight.intensity = preset.ambient - (preset.ambient > 0.7 ? 0 : i * 0.15);

    weatherParticles?.dispose();
    weatherParticles = null;
    const isOutdoor = roomId === 'room-park' || roomId === 'room-town-square';
    if (isOutdoor && (weather === 'RAIN' || weather === 'SNOW')) {
      const rain = weather === 'RAIN';
      const ps = new ParticleSystem(`weather_${weather}`, rain ? 700 : 350, scene);
      ps.particleTexture = getWeatherDotTexture();
      ps.emitter = new Vector3(0, 9, 0);
      ps.minEmitBox = new Vector3(-14, 0, -14);
      ps.maxEmitBox = new Vector3(14, 2, 14);
      if (rain) {
        ps.color1 = new Color4(0.65, 0.75, 0.95, 0.75);
        ps.color2 = new Color4(0.85, 0.9, 1, 0.6);
        ps.colorDead = new Color4(0.6, 0.7, 0.9, 0);
        ps.direction1 = new Vector3(-0.7, -9, 0);
        ps.direction2 = new Vector3(-0.2, -13, 0.6);
        ps.minSize = 0.04;
        ps.maxSize = 0.12;
        ps.minLifeTime = 0.6;
        ps.maxLifeTime = 1.1;
        ps.emitRate = Math.round(520 * (0.4 + i));
      } else {
        ps.color1 = new Color4(1, 1, 1, 0.9);
        ps.color2 = new Color4(0.85, 0.92, 1, 0.8);
        ps.colorDead = new Color4(1, 1, 1, 0);
        ps.direction1 = new Vector3(-0.5, -1.1, -0.25);
        ps.direction2 = new Vector3(0.5, -2.1, 0.25);
        ps.minSize = 0.07;
        ps.maxSize = 0.2;
        ps.minLifeTime = 2.5;
        ps.maxLifeTime = 6;
        ps.emitRate = Math.round(150 * (0.4 + i));
      }
      ps.gravity = new Vector3(0, rain ? -4 : -0.4, 0);
      ps.start();
      weatherParticles = ps;
    }
    if (lastWeather !== weather) {
      lastWeather = weather;
      showToast({ icon: preset.icon, title: `Weather: ${weather}`, durationMs: 3000 });
    }
  };

  unsubs.push(
    socketService.on<{ currentWeather: WeatherId; intensity: number }>(
      SOCKET_EVENTS.WEATHER_UPDATE,
      (w) => applyWeather(w.currentWeather, w.intensity ?? 0.5)
    )
  );

  unsubs.push(
    socketService.on<{ roomId: string; trackId: string; title?: string }>(
      SOCKET_EVENTS.JUKEBOX_TRACK_CHANGED,
      (t) => {
        showToast({ icon: '🎵', title: 'Jukebox', subtitle: `Now playing: ${t.title || t.trackId}` });
      }
    )
  );

  // ── Disposal & Cleanup ────────────────────────────────────────────────────
  scene.onDisposeObservable.add(() => {
    window.removeEventListener('keydown', onKeyDown);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', onUserActivity);
      window.removeEventListener('keydown', onUserActivity);
    }
    radarCanvas?.remove();
    radarCanvas = null;
    weatherParticles?.dispose();
    weatherParticles = null;
    weatherDotTexture?.dispose();
    weatherDotTexture = null;
    tradeModal.dispose();
    if (upvoteBtn && onUpvoteClick) {
      upvoteBtn.removeEventListener('click', onUpvoteClick);
      upvoteBtn.classList.add('hidden');
    }
    // Drop stale toasts so notifications from the previous room don't linger
    clearToasts();
    if (btnLoftSettings) {
      btnLoftSettings.removeEventListener('click', loftSettingsClickHandler);
      btnLoftSettings.classList.add('hidden');
    }
    loftSettings?.dismiss();
    loftSettings = null;
    if (btnDecorate) {
      btnDecorate.removeEventListener('click', toggleDecorate);
      btnDecorate.classList.add('hidden');
    }
    if (btnFishing) {
      btnFishing.removeEventListener('click', startFishingHandler);
      btnFishing.classList.add('hidden');
    }
    if (btnPets) {
      btnPets.removeEventListener('click', petHandler);
    }
    if (btnWorkshop) {
      btnWorkshop.removeEventListener('click', workshopHandler);
    }
    if (btnGallery) {
      btnGallery.removeEventListener('click', galleryHandler);
    }
    for (const petCtrl of localPets.values()) petCtrl.dispose();
    localPets.clear();
    scene.unregisterBeforeRender(cameraFollowCallback);
    scene.unregisterBeforeRender(footstepCallback);
    if (pointerObserver) {
      scene.onPointerObservable.remove(pointerObserver);
    }
    for (const unsub of unsubs) {
      unsub();
    }
    fishingController.dispose();
    roomEditor?.dispose();
    furnitureManager.clear();
    inputController.dispose();
    chatOverlay.dispose();
    speechBubbles.detachScene();
    avatarController.dispose();
    for (const remote of remoteAvatars.values()) {
      remote.dispose();
    }
    remoteAvatars.clear();
    badgeOccupants?.removeEventListener('click', onBadgeOccupantsClick);
    visitingBanner?.remove();
    visitingBanner = null;
    PlayersListModal.dismiss();
    AvatarContextMenu.dismiss();
    document.getElementById('room-info-pill')?.classList.add('hidden');
    document.getElementById('room-controls-card')?.classList.add('hidden');
    (window as any).__havenRoomReady = false;
  });

  (window as any).__havenRoomReady = true;
  return scene;
}
