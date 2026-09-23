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
import { InputController } from '../engine/InputController';
import { ChatOverlay } from '../ui/ChatOverlay';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';
import { API_URL } from '../config';
import { DailyLoginModal } from '../ui/DailyLoginModal';
import { LoftSettingsPanel } from '../ui/LoftSettingsPanel';
import { showToast } from '../ui/ToastNotification';
import { AvatarContextMenu } from '../ui/AvatarContextMenu';
import { PetController } from '../pets/PetController';
import { PetManagementPanel } from '../ui/PetManagementPanel';
import { WorkshopPanel } from '../ui/WorkshopPanel';
import { ClubPanel } from '../clubs/ClubPanel';
import { GalleryPanel } from '../gallery/GalleryPanel';

export async function createRoomScene(haven: HavenEngine, data?: { roomId?: string }): Promise<Scene> {
  const scene = new Scene(haven.engine);
  scene.clearColor = new Color4(0.11, 0.13, 0.17, 1.0);
  const unsubs: Array<() => void> = [];

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
    const orthoSize = 10.5; // Perfectly frames the 14m cutaway room with margins
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
  try {
    const loadResult = await roomLoader.load(roomId);
    roomMeshes = loadResult.allMeshes || [];
    if (roomMeshes.length === 0) {
      roomMeshes = buildRoomPrefab(scene, roomId) || createPlaceholderRoom(scene);
    }
  } catch {
    console.warn(`[RoomScene] Room model not found for ${roomId}. Using procedural prefab.`);
    roomMeshes = buildRoomPrefab(scene, roomId) || createPlaceholderRoom(scene);
  }

  // Setup shadow receivers
  for (const m of roomMeshes) {
    if (m.metadata?.walkable || m.name === 'placeholder_ground' || m.name.startsWith('Walkable_')) {
      m.receiveShadows = true;
    }
  }

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

  // Camera smooth follow
  const cameraFollowCallback = () => {
    if (avatarController.rootMesh) {
      camera.target = Vector3.Lerp(camera.target, avatarController.rootMesh.position, 0.1);
    }
  };
  scene.registerBeforeRender(cameraFollowCallback);

  // ── Remote Avatars ────────────────────────────────────────────────────────
  const remoteAvatars = new Map<string, RemoteAvatar>();

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
    } else {
      remote.updatePosition(p.x ?? 0, p.y ?? 0, p.z ?? 0, p.rotY ?? 0);
    }
  }

  // ── Furniture & Room Decorator ───────────────────────────────────────────
  const furnitureManager = new FurnitureManager(scene, user.id);
  (window as unknown as Record<string, unknown>).__havenFurnitureManager = furnitureManager;
  await furnitureManager.loadRoomFurniture(roomId);

  const btnDecorate = document.getElementById('btn-decorate');
  let roomEditor: RoomEditor | null = null;

  const toggleDecorate = () => {
    if (!roomEditor) return;
    if (roomEditor.inEditMode) {
      roomEditor.exitEditMode();
      if (btnDecorate) {
        btnDecorate.innerHTML = '<span class="dock-icon">🛋️</span>';
        btnDecorate.setAttribute('data-tooltip', 'Decorate Loft');
        btnDecorate.classList.remove('btn--teal');
      }
    } else {
      roomEditor.enterEditMode();
      if (btnDecorate) {
        btnDecorate.innerHTML = '<span class="dock-icon">💾</span>';
        btnDecorate.setAttribute('data-tooltip', 'Finish Decorating');
        btnDecorate.classList.add('btn--teal');
      }
    }
  };

  if (isOwner && btnDecorate) {
    btnDecorate.classList.remove('hidden');
    btnDecorate.innerHTML = '<span class="dock-icon">🛋️</span>';
    btnDecorate.setAttribute('data-tooltip', 'Decorate Loft');
    btnDecorate.classList.remove('btn--teal');
    roomEditor = new RoomEditor(scene, furnitureManager, roomId, 0);
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
            coinAmount.textContent = String(me.coinBalance);
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
  if (isOwner && btnLoftSettings) {
    btnLoftSettings.classList.remove('hidden');
    loftSettings = new LoftSettingsPanel({
      roomId,
      ownerId: user.id,
      onPrivacyChange: (mode, password) => {
        socketService.emit(SOCKET_EVENTS.SET_ROOM_PRIVACY, { roomId, mode, password });
      },
      onMoodChange: (mood) => {
        socketService.emit(SOCKET_EVENTS.SET_ROOM_MOOD, { roomId, mood });
        moodSystem.applyMood(mood);
      },
    });
    btnLoftSettings.addEventListener('click', () => loftSettings?.show());
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

  // ── Workshop, Clubs, Gallery Navigation Buttons ───────────────────────────
  const btnWorkshop = document.getElementById('btn-workshop');
  const workshopHandler = () => WorkshopPanel.show();
  btnWorkshop?.addEventListener('click', workshopHandler);

  const btnClubs = document.getElementById('btn-clubs');
  const clubsHandler = () => ClubPanel.show();
  btnClubs?.addEventListener('click', clubsHandler);

  const btnGallery = document.getElementById('btn-gallery');
  const galleryHandler = () => GalleryPanel.show();
  btnGallery?.addEventListener('click', galleryHandler);

  let localPet: PetController | null = null;
  // Listen for pet adoption event to spawn pet live
  unsubs.push(
    socketService.on<{ id: string; petType: any; name: string; happiness: number; hunger: number }>(
      SOCKET_EVENTS.PET_ADOPTED,
      (pet) => {
        if (localPet) localPet.dispose();
        if (avatarController.rootMesh) {
          localPet = new PetController(scene, pet, avatarController.rootMesh);
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
  const inputController = new InputController(scene, avatarController, camera);
  const chatOverlay = new ChatOverlay(null, (msg: ChatMessage) => {
    audioEngine.playChatMessage();
    const pid = msg.playerId || msg.senderId;
    const txt = msg.text || msg.content;
    if (pid && txt) {
      const remote = remoteAvatars.get(pid);
      if (remote) {
        remote.showSpeech(txt);
      }
    }
  });

  // ── Interaction & Context Menu Pointer Observable ────────────────────────
  const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    // Right-click on meshes (POINTERDOWN with right button or POINTERTAP)
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN && pointerInfo.event.button === 2) {
      const pick = scene.pick(scene.pointerX, scene.pointerY);
      if (pick?.hit && pick.pickedMesh) {
        const meta = pick.pickedMesh.metadata;
        if (meta?.isRemoteAvatar && meta?.userId && meta?.username) {
          AvatarContextMenu.show({
            x: pointerInfo.event.clientX,
            y: pointerInfo.event.clientY,
            targetUserId: meta.userId,
            targetUsername: meta.username,
          });
        }
      }
    }

    // Left-click on interactive trigger meshes
    if (pointerInfo.type === PointerEventTypes.POINTERPICK) {
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

  // Initial room state (players list)
  unsubs.push(
    socketService.on<{ roomId: string; players: PlayerState[] }>(
      SOCKET_EVENTS.ROOM_STATE,
      (state) => {
        if (state && Array.isArray(state.players)) {
          for (const p of state.players) {
            addOrUpdateRemoteAvatar(p);
          }
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
      x: number;
      y: number;
      z?: number;
      rotY?: number;
    }>(SOCKET_EVENTS.PLAYER_POSITION, (pos) => {
      const pid = pos.playerId || pos.userId;
      if (!pid || pid === user.id) return;
      const remote = remoteAvatars.get(pid);
      if (remote) {
        remote.updatePosition(pos.x, pos.y, pos.z ?? 0, pos.rotY ?? 0);
      }
    })
  );
  unsubs.push(
    socketService.on<{
      playerId: string;
      userId?: string;
      x: number;
      y: number;
      z?: number;
      rotY?: number;
    }>('player:move', (pos) => {
      const pid = pos.playerId || pos.userId;
      if (!pid || pid === user.id) return;
      const remote = remoteAvatars.get(pid);
      if (remote) {
        remote.updatePosition(pos.x, pos.y, pos.z ?? 0, pos.rotY ?? 0);
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
        if (data.userId !== user.id) {
          const remote = remoteAvatars.get(data.userId);
          if (remote) {
            remote.showSpeech(`[Emote: ${data.emoteId}]`);
          }
        }
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
          coinAmountEl.textContent = String(data.coins);
        }
      }
    )
  );

  // ── Disposal & Cleanup ────────────────────────────────────────────────────
  scene.onDisposeObservable.add(() => {
    window.removeEventListener('keydown', onKeyDown);
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
    if (btnClubs) {
      btnClubs.removeEventListener('click', clubsHandler);
    }
    if (btnGallery) {
      btnGallery.removeEventListener('click', galleryHandler);
    }
    localPet?.dispose();
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
    avatarController.dispose();
    for (const remote of remoteAvatars.values()) {
      remote.dispose();
    }
    remoteAvatars.clear();
    document.getElementById('room-info-pill')?.classList.add('hidden');
    document.getElementById('room-controls-card')?.classList.add('hidden');
    (window as any).__havenRoomReady = false;
  });

  (window as any).__havenRoomReady = true;
  return scene;
}
