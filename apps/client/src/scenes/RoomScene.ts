import {
  Scene,
  ArcRotateCamera,
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
} from '@babylonjs/core';
import { SOCKET_EVENTS, type PlayerState, type ChatMessage } from '@havenworld/shared';
import { HavenEngine } from '../engine/HavenEngine';
import { RoomLoader } from '../world/RoomLoader';
import { createPlaceholderRoom } from '../world/PlaceholderRoom';
import { AvatarController } from '../world/AvatarController';
import { RemoteAvatar } from '../world/RemoteAvatar';
import { InputController } from '../engine/InputController';
import { ChatOverlay } from '../ui/ChatOverlay';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';

export async function createRoomScene(haven: HavenEngine, data?: { roomId?: string }): Promise<Scene> {
  const scene = new Scene(haven.engine);
  scene.clearColor = new Color4(0.08, 0.08, 0.15, 1.0);

  const roomId = data?.roomId || authService.user?.personalRoom?.id || 'room-park';
  (window as unknown as Record<string, string>).__havenRoomId = roomId;

  // ── Show HUD & Game Container ─────────────────────────────────────────────
  document.getElementById('game-container')?.classList.remove('hidden');
  document.getElementById('room-nav')?.classList.remove('hidden');
  document.getElementById('player-card')?.classList.remove('hidden');
  document.getElementById('chat-panel')?.classList.remove('hidden');
  document.getElementById('lobby-panel')?.classList.add('hidden');
  document.getElementById('login-panel')?.classList.add('hidden');

  const usernameEl = document.querySelector('#player-card .player-card__username');
  if (usernameEl && authService.user) {
    usernameEl.textContent = authService.user.username;
  }

  // ── Fixed-Angle Isometric Camera ──────────────────────────────────────────
  const camera = new ArcRotateCamera(
    'isometricCam',
    -Math.PI / 4, // 45 deg angle
    Math.PI / 4,  // 45 deg pitch
    18,           // initial distance
    new Vector3(0, 0, 0),
    scene
  );
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 28;
  camera.lowerBetaLimit = Math.PI / 4;
  camera.upperBetaLimit = Math.PI / 4;
  camera.lowerAlphaLimit = -Math.PI / 4;
  camera.upperAlphaLimit = -Math.PI / 4;
  camera.attachControl(haven.canvas, true);

  // Lock camera rotation: remove pointer rotation & keyboard move inputs
  camera.inputs.removeByType('ArcRotateCameraPointersInput');
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

  // ── Lighting & Shadows ───────────────────────────────────────────────────
  const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
  ambientLight.intensity = 0.75;
  ambientLight.groundColor = new Color3(0.2, 0.22, 0.35);

  const sunLight = new DirectionalLight('sunLight', new Vector3(-1, -2, -1), scene);
  sunLight.position = new Vector3(15, 30, 15);
  sunLight.intensity = 1.1;

  const shadowGenerator = new ShadowGenerator(2048, sunLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 32;

  // ── Room Geometry Loading ─────────────────────────────────────────────────
  const roomLoader = new RoomLoader(scene);
  let roomMeshes: import('@babylonjs/core').AbstractMesh[] = [];
  try {
    roomMeshes = await roomLoader.load(roomId);
    if (roomMeshes.length === 0) {
      roomMeshes = createPlaceholderRoom(scene);
    }
  } catch {
    console.warn(`[RoomScene] Room model not found for ${roomId}. Using placeholder room.`);
    roomMeshes = createPlaceholderRoom(scene);
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

  // Camera smooth follow
  const cameraFollowObserver = scene.registerBeforeRender(() => {
    if (avatarController.rootMesh) {
      camera.target = Vector3.Lerp(camera.target, avatarController.rootMesh.position, 0.1);
    }
  });

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

  // ── Input & Chat Controllers ──────────────────────────────────────────────
  const inputController = new InputController(scene, avatarController, camera);
  const chatOverlay = new ChatOverlay((msg: ChatMessage) => {
    const remote = remoteAvatars.get(msg.playerId);
    if (remote) {
      remote.showSpeech(msg.text);
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
  const token = authService.token || authService.getToken() || '';
  if (token) {
    socketService.connect(token);
  }

  // Join room on server
  socketService.emit(SOCKET_EVENTS.AUTH_JOIN, { roomId });

  const unsubs: Array<() => void> = [];

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
    socketService.on<{ userId: string; username: string; position: { x: number; y: number; z: number; rotY: number }; avatarData?: any }>(
      'player:join',
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

  // ── Disposal & Cleanup ────────────────────────────────────────────────────
  scene.onDisposeObservable.add(() => {
    window.removeEventListener('keydown', onKeyDown);
    if (cameraFollowObserver) {
      scene.unregisterBeforeRender(cameraFollowObserver);
    }
    for (const unsub of unsubs) {
      unsub();
    }
    inputController.dispose();
    chatOverlay.dispose();
    avatarController.dispose();
    for (const remote of remoteAvatars.values()) {
      remote.dispose();
    }
    remoteAvatars.clear();
    roomLoader.unload();
  });

  return scene;
}
