import { mountWardrobe, renderIdentityControls } from './shared/wardrobe.js';

import { formatResidency, createIdentity, normalizeAvatar, AVATAR_OPTIONS, COLOR_KEYS, TITLES, AURAS, canEquip } from './shared/identity-model.js';
import { drawModularAvatar, drawAura } from './shared/avatar.js';

// HavenWorld — Game Engine & Multiplayer Client (HTML5 Canvas + WebSockets)
// ES module: pure logic is imported from shared/ (unit-tested in Node).
import { toScreen as isoToScreen, toGrid as isoToGrid } from './shared/iso.js';
import { calculateFacing, getWalkBob, stepToward, frameDt, fadeAlpha } from './shared/movement.js';
import { RECIPES, pickRecipe, matchRecipe, scoreCoins } from './shared/pizza.js';
import { escapeHtml } from './shared/chat.js';
import { initAudio, playFootstep, playFurniPop, playCoinChime, playChatPing, playDoorwayWhoosh, playSitSound, playSwitchClick, toggleMuted, getMuted } from './shared/audio.js';
import { PASSPORT_STAMPS, createDefaultPassport, recordPassportAction, getPassportProgress } from './shared/passport.js';
import { computeJumpOffset, computeWaveAngle, computeDanceOffset, computeShadowScale } from './shared/emotes.js';
import { furnitureDepthKey, avatarDepthKey } from './shared/zsort.js';
import { decodePlayerDelta, intToFacing, interpolatePosition } from './shared/authority.js';
import { CATALOG_ITEMS, getRotatingFeaturedStock, getTimeUntilNextRotation } from './shared/catalog.js';
import { WORKSHOP_RECIPES, calculateSalvageYield, canCraftRecipe } from './shared/crafting.js';
import { createPet, advancePetAI, petInteract } from './shared/pet.js';

  // State
  let ws = null;
  let selfId = null;
  let authToken = null; // WS auth token (persisted account player ID, if logged in)
  let authPlayerId = null; // Persisted account player ID (if logged in)

  const initialSavedName = (typeof localStorage !== 'undefined' && localStorage.getItem('haven_player_name')) || '';

  let identityState = createIdentity();
  let selfPlayer = {
    id: null,
    name: initialSavedName || 'Traveler',
    x: 5,
    y: 5,
    targetX: 5,
    targetY: 5,
    coins: 1000,
    avatar: {
      skin: '#f5cba7',
      hairStyle: 'cozy_messy',
      hairColor: '#4a235a',
      shirtColor: '#2e86c1',
      pantsColor: '#34495e'
    },
    lastChat: null,
    activeEmote: null
  };
  const otherPlayers = new Map();

  // Leaf particles spawned from clicking plants/trees
  const leafParticles = [];
  // Hovered world object tooltip state
  let hoveredEntity = null;
  // Room transition state (fade-out/fade-in)
  let roomTransition = {
    phase: 'idle', // 'idle' | 'out' | 'in'
    alpha: 0,
    targetName: '',
    startTime: 0,
    duration: 260
  };
  let currentRoom = {
    id: 'plaza',
    name: 'Central Plaza & Lounge',
    furniture: []
  };

  // Friends & Private Messaging State
  let friendsData = { friends: [], pendingRequests: [] };
  let pmTarget = null; // { id: string, name: string }

  // Daily bonus cooldown state
  let dailyCooldown = null; // { canClaim, lastClaim, nextClaimAvailable, timeRemainingMs }
  let dailyCountdownInterval = null;

  // DOM References (friends panel)
  const friendsModal = document.getElementById('friends-modal');
  const friendsBadge = document.getElementById('friends-badge');
  const friendsListEl = document.getElementById('friends-list');
  const pendingListEl = document.getElementById('pending-requests-list');
  const pmHistory = document.getElementById('pm-history');
  const friendNameInput = document.getElementById('friend-name-input');
  const pmTargetInput = document.getElementById('pm-target');
  const pmTextInput = document.getElementById('pm-text');

  // Account modal DOM
  const accountModal = document.getElementById('account-modal');
  const accountFormSignedOut = document.getElementById('account-form-signed-out');
  const accountFormLoggedIn = document.getElementById('account-form-logged-in');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const loginErrorEl = document.getElementById('login-error');
  const signupErrorEl = document.getElementById('signup-error');
  const loginUsernameInput = document.getElementById('login-username');
  const loginPasswordInput = document.getElementById('login-password');
  const signupUsernameInput = document.getElementById('signup-username');
  const signupPasswordInput = document.getElementById('signup-password');

  // Daily bonus popup DOM
  const dailyPopup = document.getElementById('daily-popup');
  const dailyPopupMsg = document.getElementById('daily-popup-message');
  const dailyCooldownText = document.getElementById('daily-cooldown-text');

  // Context menu & player interaction state
  let activeContextPlayer = null; // { id, name }
  const playerContextMenu = document.getElementById('player-context-menu');
  const ctxPlayerName = document.getElementById('ctx-player-name');

  // Welcome modal DOM
  const welcomeOverlay = document.getElementById('welcome-overlay');
  const btnWelcomeGuest = document.getElementById('btn-welcome-guest');
  const btnWelcomeSignin = document.getElementById('btn-welcome-signin');
  const btnWelcomeSignup = document.getElementById('btn-welcome-signup');

  // Floating heart particles for emotes
  const floatingHearts = [];

  let editMode = false;
  let selectedFurnitureType = 'sofa';
  let targetIndicator = null; // { x, y, alpha }
  let parentSurfaceId = null; // Furniture id to place on top of (surface parenting)

  // Canvas & Context
  const canvas = document.getElementById('viewport');
  const ctx = canvas.getContext('2d');

  // Isometric Constants (Enlarged playable area by +125% area, 2:1 isometric ratio)
  const TILE_WIDTH = 96;
  const TILE_HEIGHT = 48;
  const DEFAULT_GRID_SIZE = 12;
  function getRoomGridWidth() { return currentRoom?.gridWidth || DEFAULT_GRID_SIZE; }
  function getRoomGridHeight() { return currentRoom?.gridHeight || DEFAULT_GRID_SIZE; }
  let currentFurniRotation = 0; // 0, 90, 180, 270

  // Emotes whose animation replaces the locomotion pose in the world renderer.
  const POSE_EMOTES = ['dance', 'run', 'lie'];

  // Bind canvas-derived origin to the shared pure isometric converters.
  // Dynamically centers any room size (12x12 to 20x20) within the viewport.
  function origin() {
    const gw = getRoomGridWidth();
    const gh = getRoomGridHeight();
    const roomDepth = (gw + gh) * (TILE_HEIGHT / 4);
    const targetY = Math.max(90, Math.min(canvas.height * 0.28, (canvas.height - roomDepth) / 2 + 10));
    return { x: canvas.width / 2, y: targetY };
  }
  function toScreen(gx, gy) {
    const o = origin();
    return isoToScreen(gx, gy, o.x, o.y, TILE_WIDTH, TILE_HEIGHT);
  }
  function toGrid(sx, sy) {
    const o = origin();
    return isoToGrid(sx, sy, o.x, o.y, TILE_WIDTH, TILE_HEIGHT);
  }

  // Resize Canvas
  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Resume Web Audio on first user interaction (browser policy)
  const unlockAudio = () => {
    initAudio();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // ==========================================================================
  // WebSocket Multiplayer Networking
  // ==========================================================================
  function initWebSocket(token = null, guestId = null) {
    authToken = token;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}`;
    const params = [];
    if (token) {
      params.push('token=' + encodeURIComponent(token));
    } else if (guestId) {
      params.push('guestId=' + encodeURIComponent(guestId));
    }
    const storedName = localStorage.getItem('haven_player_name') || selfPlayer.name;
    if (storedName && storedName !== 'Traveler') {
      params.push('name=' + encodeURIComponent(storedName));
    }
    if (params.length > 0) {
      wsUrl += '?' + params.join('&');
    }
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendChatMessage('system', 'Connected to HavenWorld real-time server.');
      // Request daily cooldown state on connect
      sendWs({ type: 'GET_DAILY_COOLDOWN', payload: null });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    ws.onclose = () => {
      appendChatMessage('system', 'Disconnected from server. Retrying in 3 seconds...');
      setTimeout(() => {
        const currentGuest = localStorage.getItem('haven_guest_id');
        initWebSocket(authToken, currentGuest);
      }, 3000);
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'INIT_STATE': {
        selfId = msg.payload.selfId || msg.payload.playerId || msg.payload.player?.id;
        const serverName = msg.payload.player?.name;
        const storedName = localStorage.getItem('haven_player_name');
        const resolvedName = (serverName && !serverName.startsWith('usr_')) ? serverName : (storedName || serverName || 'Traveler');
        selfPlayer = { ...selfPlayer, ...msg.payload.player, id: selfId, name: resolvedName };
        identityState = msg.payload.identity || createIdentity(selfId, selfPlayer.name);
        localPassport = identityState.passport;
        if (storedName && (!serverName || serverName.startsWith('usr_') || serverName.startsWith('Traveler #'))) {
          // Sync server state with player's customized name
          sendWs({ type: 'CHAT', payload: { text: `/name ${storedName}` } });
        }
        if (resolvedName && resolvedName !== 'Traveler') {
          localStorage.setItem('haven_player_name', resolvedName);
        }
        currentRoom = msg.payload.room;
        otherPlayers.clear();
        msg.payload.otherPlayers.forEach(p => otherPlayers.set(p.id, p));
        updateCoinUI(selfPlayer.coins);
        if (selfPlayer.gems !== undefined) updateGemUI(selfPlayer.gems);
        if (selfPlayer.materials) updateMaterialsUI(selfPlayer.materials);
        applyRoomMood(currentRoom.ambientMood || 'day');

        // If the server sent us a personal loft room ID, add it to the dropdown
        if (msg.payload.playerLoftRoomId) {
          addLoftToRoomSelector(msg.payload.playerLoftRoomId, msg.payload.playerLoftName);
        }

        // Accurately synchronize the room-select dropdown to the player's active room
        const roomSelect = document.getElementById('room-select');
        if (roomSelect) {
          roomSelect.value = currentRoom.id;
        }
        break;
      }

      case 'PLAYER_JOINED': {
        const p = msg.payload.player;
        if (p.id !== selfId) {
          otherPlayers.set(p.id, p);
          appendChatMessage('system', `${p.name} walked into the room.`);
        }
        break;
      }

      case 'PLAYER_MOVED': {
        const { playerId, startX, startY, targetX, targetY, isSitting, facing } = msg.payload;
        if (playerId === selfId) {
          selfPlayer.targetX = targetX;
          selfPlayer.targetY = targetY;
          if (typeof isSitting === 'boolean') {
            if (isSitting && !selfPlayer.isSitting) playSitSound();
            selfPlayer.isSitting = isSitting;
          }
          if (facing) selfPlayer.facing = facing;
        } else if (otherPlayers.has(playerId)) {
          const p = otherPlayers.get(playerId);
          // Seed the interpolation buffer from the authoritative snapshot.
          p.renderX = (typeof startX === 'number') ? startX : p.x;
          p.renderY = (typeof startY === 'number') ? startY : p.y;
          p.interpFrom = { x: p.renderX, y: p.renderY, t: performance.now() };
          p.interpTo = { x: targetX, y: targetY, t: performance.now() + 100 };
          p.x = startX;
          p.y = startY;
          p.targetX = targetX;
          p.targetY = targetY;
          if (typeof isSitting === 'boolean') p.isSitting = isSitting;
          if (facing) p.facing = facing;
        }
        break;
      }

      case 'PLAYER_DELTA': {
        const deltas = msg.payload?.deltas || [];
        for (const d of deltas) {
          const s = decodePlayerDelta(d);
          if (s.id === selfId) continue; // self is predicted locally; reconcile handles drift
          const p = otherPlayers.get(s.id);
          if (!p) continue;
          const now = performance.now();
          const from = { x: (typeof p.renderX === 'number') ? p.renderX : p.x, y: (typeof p.renderY === 'number') ? p.renderY : p.y };
          p.interpFrom = { ...from, t: now };
          p.interpTo = { x: s.x, y: s.y, t: now + 100 };
          p.x = s.x;
          p.y = s.y;
          p.targetX = s.x;
          p.targetY = s.y;
          p.facing = s.facing;
          p.isSitting = s.isSitting;
          p.isWalking = s.isWalking;
        }
        break;
      }

      case 'RECONCILE_POSITION': {
        selfPlayer.x = msg.payload.x;
        selfPlayer.y = msg.payload.y;
        selfPlayer.targetX = msg.payload.targetX;
        selfPlayer.targetY = msg.payload.targetY;
        break;
      }

      case 'MOVE_REJECTED': {
        selfPlayer.targetX = msg.payload.targetX;
        selfPlayer.targetY = msg.payload.targetY;
        break;
      }

      case 'PLAYER_PROFILE_UPDATED': {
        const { playerId, player } = msg.payload;
        if (playerId === selfId) {
          Object.assign(selfPlayer, { title: player.title, statusMessage: player.statusMessage, pinnedBadges: player.pinnedBadges });
          selfPlayer.name = player.name;
          selfPlayer.avatar = player.avatar;
          if (player.name && !player.name.startsWith('usr_')) {
            localStorage.setItem('haven_player_name', player.name);
          }
          // If name changed, update the account display
          if (authPlayerId) {
            document.getElementById('account-player-name').textContent = selfPlayer.name;
          }
        } else if (otherPlayers.has(playerId)) {
          const existing = otherPlayers.get(playerId);
          otherPlayers.set(playerId, { ...existing, ...player });
        }
        break;
      }

      case 'IDENTITY_UPDATED': {
        const previous = identityState.passport.unlockedStamps;
        const outfitChanged = JSON.stringify(identityState.outfit) !== JSON.stringify(msg.payload.outfit);
        identityState = msg.payload;
        localPassport = identityState.passport;
        if (outfitChanged && identityState.outfit) selfPlayer.avatar = normalizeAvatar(identityState.outfit);
        for (const id of Object.keys(localPassport.unlockedStamps)) {
          if (!previous[id] && PASSPORT_STAMPS[id]) showToast(`Achievement Unlocked: ${PASSPORT_STAMPS[id].title}`, PASSPORT_STAMPS[id].icon);
        }
        if (!avatarModal.classList.contains('hidden')) renderAvatarPreview();
        if (!passportModal.classList.contains('hidden')) renderPassportUI();
        break;
      }
      case 'IDENTITY_ERROR': {
        showToast(msg.payload.message, '⚠️');
        break;
      }
      case 'SYSTEM_MESSAGE': {
        appendChatMessage('system', msg.payload.text, msg.payload.type || 'system');
        break;
      }

      case 'CHAT_MESSAGE': {
        const { playerId, sender, text } = msg.payload;
        const p = playerId === selfId ? selfPlayer : otherPlayers.get(playerId);
        if (p) {
          p.lastChat = { text, timestamp: Date.now() };
        }
        appendChatMessage(sender, text);
        playChatPing();
        break;
      }

      case 'ROOM_CHANGED': {
        currentRoom = msg.payload.room;
        applyRoomMood(currentRoom.ambientMood || 'day');
        const savedName = localStorage.getItem('haven_player_name') || selfPlayer.name;
        const serverPlayer = msg.payload.player || {};
        if (savedName && (!serverPlayer.name || serverPlayer.name.startsWith('usr_'))) {
          serverPlayer.name = savedName;
        }
        selfPlayer = { ...selfPlayer, ...serverPlayer };
        otherPlayers.clear();
        msg.payload.otherPlayers.forEach(p => otherPlayers.set(p.id, p));
        appendChatMessage('system', `Entered: ${currentRoom.name}`);
        playDoorwayWhoosh();
        triggerPassportAction('ENTER_ROOM', { roomId: currentRoom.id });

        // Trigger smooth fade-in
        roomTransition.phase = 'in';
        roomTransition.startTime = performance.now();
        roomTransition.targetName = currentRoom.name;

        // Update room selector
        const roomSelect = document.getElementById('room-select');
        if (roomSelect) {
          roomSelect.value = currentRoom.id;
          if (currentRoom.id.startsWith('loft_')) {
            addLoftToRoomSelector(currentRoom.id, currentRoom.name);
          }
        }
        break;
      }

      case 'FURNITURE_ADDED': {
        currentRoom.furniture.push(msg.payload.item);
        playFurniPop();
        break;
      }

      case 'FURNITURE_REMOVED': {
        const id = msg.payload.id;
        currentRoom.furniture = currentRoom.furniture.filter(f => f.id !== id);
        playFurniPop();
        break;
      }

      case 'FURNITURE_STATE_UPDATED': {
        const { furnitureId, state } = msg.payload;
        const furni = currentRoom.furniture.find(f => f.id === furnitureId);
        if (furni) {
          furni.state = { ...(furni.state || {}), ...state };
          playSwitchClick();
        }
        break;
      }

      case 'ROOM_CLEARED': {
        currentRoom.furniture = [];
        break;
      }

      case 'FURNITURE_ERROR': {
        appendChatMessage('system', `Error: ${msg.payload.message}`);
        break;
      }

      case 'COINS_UPDATED': {
        selfPlayer.coins = msg.payload.coins;
        updateCoinUI(selfPlayer.coins);
        appendChatMessage('system', `🪙 +${msg.payload.earned} HavenCoins (${msg.payload.reason})!`);
        playCoinChime();
        break;
      }

      case 'DAILY_BONUS_ERROR': {
        // Show the popup warning that the daily gift was already claimed
        showDailyBonusPopup(msg.payload.message, msg.payload.nextClaimAvailable);
        break;
      }

      case 'DAILY_COOLDOWN_UPDATE': {
        dailyCooldown = msg.payload;
        updateDailyCountdown();
        if (dailyCountdownInterval) clearInterval(dailyCountdownInterval);
        dailyCountdownInterval = setInterval(updateDailyCountdown, 1000);
        // If can't claim, update the button to show it's on cooldown
        updateDailyBonusButton();
        break;
      }

      case 'SYSTEM_ANNOUNCEMENT': {
        appendChatMessage('system', msg.payload.text);
        break;
      }

      case 'PLAYER_LEFT': {
        const p = otherPlayers.get(msg.payload.playerId);
        if (p) {
          appendChatMessage('system', `${p.name} left the room.`);
          otherPlayers.delete(msg.payload.playerId);
        }
        break;
      }

      case 'FRIENDS_LIST_UPDATE': {
        friendsData.friends = msg.payload.friends || [];
        friendsData.pendingRequests = msg.payload.pendingRequests || [];
        renderFriendsList();
        appendChatMessage('system', `You have ${friendsData.friends.length} friends and ${friendsData.pendingRequests.length} pending request(s).`);
        break;
      }

      case 'FRIEND_REQUEST_RECEIVED': {
        const { fromPlayerId, fromPlayerName } = msg.payload;
        friendsData.pendingRequests.push({ requesterId: fromPlayerId, createdAt: new Date().toISOString() });
        renderFriendsList();
        updateFriendRequestBadge();
        appendChatMessage('system', `📬 ${fromPlayerName} sent you a friend request!`);
        break;
      }

      case 'FRIEND_REQUEST_SENT': {
        appendChatMessage('system', `Friend request sent: ${msg.payload.message}`);
        break;
      }

      case 'FRIEND_REQUEST_ACCEPTED': {
        appendChatMessage('system', `Friend request accepted: ${msg.payload.message}`);
        friendNameInput.value = '';
        renderFriendsList();
        break;
      }

      case 'FRIEND_REQUEST_ERROR': {
        appendChatMessage('system', `Error: ${msg.payload.message}`);
        break;
      }

      case 'PRIVATE_MESSAGE_RECEIVED': {
        const { fromPlayerId, fromPlayerName, text } = msg.payload;
        const isSelf = fromPlayerId === selfPlayer.id;
        if (!isSelf) {
          friendNameInput.value = '';
        }
        appendPMMessage(fromPlayerName, text, isSelf);
        renderFriendsList();
        playChatPing();
        break;
      }

      case 'PRIVATE_MESSAGE_ERROR': {
        appendChatMessage('system', `PM Error: ${msg.payload.message}`);
        break;
      }

      case 'PRIVATE_MESSAGES_LIST': {
        const messages = msg.payload.messages || [];
        pmHistory.innerHTML = '<div class="empty-state">No messages</div>';
        if (messages.length > 0) {
          pmHistory.innerHTML = '';
          messages.forEach(m => appendPMMessage(m.senderId, m.text, false));
        }
        break;
      }

      case 'PLAYER_EMOTE':
      case 'PLAYER_EMOTED': {
        const fromPlayerId = msg.payload.fromPlayerId || msg.payload.playerId;
        const emote = msg.payload.emote;
        const targetPlayerId = msg.payload.targetPlayerId;

        const fromP = fromPlayerId === selfPlayer.id ? selfPlayer : otherPlayers.get(fromPlayerId);
        if (fromP) {
          triggerPlayerEmote(fromP, emote);
        }
        if (targetPlayerId) {
          const toP = targetPlayerId === selfPlayer.id ? selfPlayer : otherPlayers.get(targetPlayerId);
          if (toP) triggerPlayerEmote(toP, emote);
        }
        break;
      }

      case 'ROOM_STYLE_UPDATED': {
        if (msg.payload.roomId === currentRoom.id) {
          if (msg.payload.flooring) currentRoom.flooring = msg.payload.flooring;
          if (msg.payload.wallpaper) currentRoom.wallpaper = msg.payload.wallpaper;
        }
        break;
      }

      case 'ROOM_DIRECTORY_UPDATE': {
        renderRoomDirectory(msg.payload.publicRooms || [], msg.payload.personalLofts || []);
        break;
      }

      case 'TRADE_REQUEST_RECEIVED': {
        const { tradeId, fromPlayerName } = msg.payload;
        showToast(`${fromPlayerName} wants to trade with you!`, '🤝');
        if (confirm(`🤝 ${fromPlayerName} wants to trade with you! Accept trade?`)) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'TRADE_ACCEPT', payload: { tradeId } }));
          }
        }
        break;
      }

      case 'TRADE_REQUEST_SENT': {
        showToast(`Trade request sent to ${msg.payload.targetPlayerName}.`, '🤝');
        break;
      }

      case 'TRADE_STARTED': {
        activeTradeSession = msg.payload.session;
        document.getElementById('partner-trade-title').textContent = `${msg.payload.partnerName}'s Offer`;
        document.getElementById('trade-modal').classList.remove('hidden');
        updateTradeUI(msg.payload.session);
        showToast(`Trade started with ${msg.payload.partnerName}!`, '🤝');
        break;
      }

      case 'TRADE_UPDATED': {
        updateTradeUI(msg.payload.session);
        break;
      }

      case 'TRADE_COMPLETED': {
        document.getElementById('trade-modal').classList.add('hidden');
        activeTradeSession = null;
        showToast('Trade completed successfully!', '🎉');
        playCoinChime();
        break;
      }

      case 'TRADE_CANCELED': {
        document.getElementById('trade-modal').classList.add('hidden');
        activeTradeSession = null;
        showToast(msg.payload.reason || 'Trade canceled.', '⚠️');
        break;
      }

      case 'TRADE_ERROR': {
        showToast(msg.payload.message, '⚠️');
        break;
      }

      // --- Track 3: Loft Expansion, Permissions, Mood, Doorbell & Whiteboard ---
      case 'ROOM_EXPANDED': {
        currentRoom.gridWidth = msg.payload.width;
        currentRoom.gridHeight = msg.payload.height;
        const sizeLabel = document.getElementById('loft-current-size');
        if (sizeLabel) sizeLabel.textContent = `${msg.payload.width}×${msg.payload.height} Tiles`;
        showToast(`Sanctuary expanded to ${msg.payload.width}×${msg.payload.height}! 📐`, '🏰');
        playFurniPop();
        break;
      }

      case 'ROOM_PERMISSIONS_UPDATED': {
        currentRoom.accessMode = msg.payload.accessMode;
        showToast(`Sanctuary access set to ${msg.payload.accessMode.toUpperCase()}! 🔒`, '✅');
        break;
      }

      case 'ROOM_ACCESS_DENIED': {
        pendingRestrictedRoomId = msg.payload.roomId;
        const nameEl = document.getElementById('doorbell-room-name');
        if (nameEl) nameEl.textContent = msg.payload.roomName || 'This Sanctuary';
        const doorbellVisitorModal = document.getElementById('doorbell-visitor-modal');
        if (doorbellVisitorModal) doorbellVisitorModal.classList.remove('hidden');
        showToast(msg.payload.reason || 'Sanctuary access is restricted.', '🚪');
        break;
      }

      case 'DOORBELL_RING': {
        pendingDoorbellVisitorId = msg.payload.visitorId;
        const guestEl = document.getElementById('doorbell-guest-name');
        if (guestEl) guestEl.textContent = msg.payload.visitorName || 'A Traveler';
        const doorbellHostModal = document.getElementById('doorbell-host-modal');
        if (doorbellHostModal) doorbellHostModal.classList.remove('hidden');
        playChatPing();
        showToast(`🔔 ${msg.payload.visitorName || 'A Traveler'} rang your doorbell!`, '🔔');
        break;
      }

      case 'DOORBELL_RESULT': {
        if (msg.payload.allowed) {
          showToast('Doorbell answered: Entry granted! 🚪✨', '🎉');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SWITCH_ROOM', payload: { roomId: msg.payload.roomId } }));
          }
        } else {
          showToast('The host declined entry.', '🚪');
        }
        break;
      }

      case 'ROOM_MOOD_UPDATED': {
        currentRoom.ambientMood = msg.payload.mood;
        applyRoomMood(msg.payload.mood);
        showToast(`Sanctuary ambiance updated: ${msg.payload.mood}! 🌅`, '✨');
        break;
      }

      case 'DECORATOR_UPDATED': {
        currentRoom.decorators = msg.payload.decorators || [];
        renderLoftDecoratorsList();
        showToast(msg.payload.message || 'Decorator permissions updated.', '🤝');
        break;
      }

      case 'WHITEBOARD_STROKE': {
        drawWhiteboardStroke(msg.payload.stroke);
        break;
      }

      case 'WHITEBOARD_CLEARED': {
        const wbCanvas = document.getElementById('whiteboard-canvas');
        if (wbCanvas) {
          const wbCtx = wbCanvas.getContext('2d');
          wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
        }
        break;
      }

      // --- Track 4: Dual Currency, Marketplace, Workshop & Pets ---
      case 'GEMS_UPDATED': {
        selfPlayer.gems = msg.payload.gems;
        updateGemUI(selfPlayer.gems);
        showToast(`💎 +${msg.payload.earned || 0} HavenGems (${msg.payload.reason || 'Reward'})!`, '💎');
        playCoinChime();
        break;
      }

      case 'MARKETPLACE_LISTINGS': {
        activeMarketplaceListings = msg.payload.listings || [];
        renderMarketplaceListings();
        renderMyMarketplaceListings();
        break;
      }

      case 'MARKETPLACE_SUCCESS': {
        showToast(msg.payload.message || 'Marketplace transaction successful! 🛒', '🎉');
        playCoinChime();
        sendWs({ type: 'BROWSE_MARKETPLACE', payload: {} });
        break;
      }

      case 'RECYCLE_SUCCESS': {
        selfPlayer.materials = msg.payload.materials;
        updateMaterialsUI(selfPlayer.materials);
        const y = msg.payload.yield || {};
        showToast(`Dismantled! Salvaged +${y.scrap_metal || 0} Scrap Metal 🔩, +${y.timber || 0} Timber 🪵`, '🔨');
        playFurniPop();
        populateRecycleDropdown();
        break;
      }

      case 'CRAFT_SUCCESS': {
        selfPlayer.materials = msg.payload.materials;
        updateMaterialsUI(selfPlayer.materials);
        showToast(`Crafted ${msg.payload.recipeName || 'item'}! Added to decorator inventory! ✨`, '🔨');
        playFurniPop();
        renderCraftingRecipes();
        break;
      }

      case 'VIP_UPDATED': {
        selfPlayer.isVip = !!msg.payload.isVip;
        selfPlayer.vipExpiresAt = msg.payload.vipExpiresAt || null;
        updateVipBadge();
        showToast(`Club Haven VIP: ${selfPlayer.isVip ? 'Active! 👑 2% Market Tax + Perks' : 'Expired'}`, '👑');
        break;
      }

      case 'PETS_UPDATED': {
        currentRoom.pets = msg.payload.pets || [];
        break;
      }

      case 'PET_INTERACT_RESULT': {
        playChatPing();
        showToast(`Pet reacted: ${msg.payload.emote || '❤️'} (${msg.payload.reaction || 'Friendly'})`, '🐾');
        break;
      }
    }
  }

  // ==========================================================================
  // Daily Bonus Cooldown UI
  // ==========================================================================

  function addLoftToRoomSelector(roomId, roomName) {
    const roomSelect = document.getElementById('room-select');
    // Check if this loft option already exists
    let existing = null;
    for (let i = 0; i < roomSelect.options.length; i++) {
      if (roomSelect.options[i].value === roomId) {
        existing = roomSelect.options[i];
        break;
      }
    }
    if (!existing) {
      const opt = document.createElement('option');
      opt.value = roomId;
      opt.textContent = `🏡 ${roomName}`;
      roomSelect.add(opt);
    }
  }

  function showDailyBonusPopup(message, nextClaimAvailable) {
    dailyPopupMsg.textContent = message;
    const now = Date.now();
    const msLeft = nextClaimAvailable - now;
    if (msLeft > 0) {
      updateDailyCountdownText(msLeft);
    }
    dailyPopup.classList.remove('hidden');
  }

  function updateDailyCountdown() {
    if (!dailyCooldown) return;
    if (!dailyCooldown.canClaim) {
      const msLeft = dailyCooldown.timeRemainingMs;
      if (msLeft > 0) {
        updateDailyCountdownText(msLeft);
      }
    }
  }

  function updateDailyCountdownText(msLeft) {
    const hours = Math.floor(msLeft / (60 * 60 * 1000));
    const mins = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
    const secs = Math.floor((msLeft % (60 * 1000)) / 1000);
    dailyCooldownText.textContent = `Next gift available in: ${hours}h ${mins}m ${secs}s`;
  }

  function updateDailyBonusButton() {
    const btn = document.getElementById('btn-daily-bonus');
    if (!dailyCooldown || dailyCooldown.canClaim) {
      btn.textContent = '🎁 Daily Gift';
      btn.disabled = false;
    } else {
      const hours = Math.floor(dailyCooldown.timeRemainingMs / (60 * 60 * 1000));
      const mins = Math.floor((dailyCooldown.timeRemainingMs % (60 * 60 * 1000)) / (60 * 1000));
      btn.textContent = `🎁 Come back in ${hours}h ${mins}m`;
      btn.disabled = true;
    }
  }

  // =========================================================================
  // Render Loop (60 FPS)
  // =========================================================================
  let lastTime = performance.now();

  function gameLoop(now) {
    const dt = frameDt(now, lastTime);
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(gameLoop);
  }

  function update(dt) {
    // Move self (local prediction; server reconciles drift)
    updatePlayerMovement(selfPlayer, dt);

    // Move others: authoritative deltas drive interp buffer; stepToward
    // advances the sim toward the latest target between delta frames.
    const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    for (const [_, p] of otherPlayers) {
      updatePlayerMovement(p, dt);
      if (p.interpFrom && p.interpTo) {
        const span = Math.max(1, p.interpTo.t - p.interpFrom.t);
        const alpha = Math.max(0, Math.min(1, (nowMs - p.interpFrom.t) / span));
        const ip = interpolatePosition(p.interpFrom, p.interpTo, alpha);
        p.renderX = ip.x;
        p.renderY = ip.y;
      } else {
        p.renderX = p.x;
        p.renderY = p.y;
      }
    }
    selfPlayer.renderX = selfPlayer.x;
    selfPlayer.renderY = selfPlayer.y;

    // Target indicator fade
    if (targetIndicator) {
      targetIndicator.alpha -= dt * 1.5;
      if (targetIndicator.alpha <= 0) targetIndicator = null;
    }

    // Update floating heart particles
    for (let i = floatingHearts.length - 1; i >= 0; i--) {
      const h = floatingHearts[i];
      h.life -= dt;
      if (h.life <= 0) {
        floatingHearts.splice(i, 1);
        continue;
      }
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.alpha = h.life / h.maxLife;
    }
  }

  function updatePlayerMovement(p, dt) {
    const oldCycle = p.walkCycle || 0;
    stepToward(p, dt, 3.8);
    if (p.isWalking) {
      p.walkCycle = oldCycle + dt * 10;
      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      p.facing = calculateFacing(dx, dy, p.facing || 'SE');
      if (p === selfPlayer) {
        if (Math.floor(p.walkCycle / Math.PI) > Math.floor(oldCycle / Math.PI)) {
          playFootstep();
          triggerPassportAction('STEP');
        }
      }
    } else {
      p.walkCycle = 0;
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Isometric Floor & Grid
    drawIsometricFloor();

    // Draw Ambient Lighting from active light sources
    drawAmbientLighting();

    // Draw Target Move Click Ripple
    if (targetIndicator) {
      drawTargetRipple(targetIndicator);
    }

    // Collect all renderable entities for Z-sorting
    // Deterministic depth key: (x + y) + priority (floor < rug < low < avatar < tall)
    // + sub-tile bias; multi-tile furniture anchors on its far corner.
    const entities = [];

    // Furniture
    currentRoom.furniture.forEach(f => {
      entities.push({
        type: 'furniture',
        item: f,
        sortY: furnitureDepthKey(f)
      });
    });

    // Players
    entities.push({
      type: 'player',
      player: selfPlayer,
      isSelf: true,
      sortY: avatarDepthKey(selfPlayer)
    });

    for (const [_, p] of otherPlayers) {
      entities.push({
        type: 'player',
        player: p,
        isSelf: false,
        sortY: avatarDepthKey(p)
      });
    }

    // Depth sort: lower key renders behind higher key
    entities.sort((a, b) => a.sortY - b.sortY);

    // Render sorted entities
    entities.forEach(entity => {
      if (entity.type === 'furniture') {
        drawFurniture(entity.item);
      } else if (entity.type === 'player') {
        drawAvatar(entity.player, entity.isSelf);
      }
    });

    // Render Overhead Speech Bubbles (Always on top layer)
    entities.forEach(entity => {
      if (entity.type === 'player') {
        drawSpeechBubble(entity.player);
      }
    });

    // Render floating emote heart particles
    renderFloatingHearts();

    // Render drifting leaf particles from rustled plants
    drawLeafParticles();

    // Render in-world hover tooltip HUD
    drawTooltip();

    // Render cinematic room transition overlay (fade-in / fade-out)
    drawRoomTransition();
  }

  function triggerPlayerEmote(p, emote) {
    if (!p) return;
    const durationMap = { jump: 750, wave: 1300, dance: 1800, hug: 1400, heart: 1400 };
    const dur = durationMap[emote] || 1200;
    p.activeEmote = {
      type: emote,
      startTime: performance.now(),
      duration: dur
    };

    if (emote === 'hug' || emote === 'heart') {
      spawnEmoteHearts(p.x, p.y);
      p.lastChat = { text: '💖 Hug!', timestamp: Date.now() };
    } else if (emote === 'jump') {
      p.lastChat = { text: '🦘 Hop!', timestamp: Date.now() };
    } else if (emote === 'wave') {
      p.lastChat = { text: '👋 Hello!', timestamp: Date.now() };
    } else if (emote === 'dance') {
      p.lastChat = { text: '💃 Groove!', timestamp: Date.now() };
    } else {
      p.lastChat = { text: emote, timestamp: Date.now() };
    }
  }

  function rustlePlant(plant) {
    if (!plant) return;
    plant.wobbleStart = performance.now();
    playSwitchClick();
    const pt = toScreen(plant.x, plant.y);
    const originX = pt.x;
    const originY = pt.y + TILE_HEIGHT / 2 - 36;
    const leafColors = ['#4ade80', '#22c55e', '#16a34a', '#86efac', '#a3e635'];
    for (let i = 0; i < 9; i++) {
      leafParticles.push({
        x: originX + (Math.random() - 0.5) * 32,
        y: originY + (Math.random() - 0.5) * 24,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 0.8 + Math.random() * 1.6,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.12,
        color: leafColors[Math.floor(Math.random() * leafColors.length)],
        size: 3.5 + Math.random() * 3,
        alpha: 1.0,
        birth: performance.now(),
        life: 1100 + Math.random() * 600
      });
    }
  }

  function playArcadeJingle() {
    playCoinChime();
    setTimeout(() => playFurniPop(), 90);
    setTimeout(() => playCoinChime(), 180);
  }

  function startRoomTransition(targetName = '') {
    roomTransition = {
      phase: 'out',
      alpha: 0,
      targetName: targetName || 'New Sanctuary',
      startTime: performance.now(),
      duration: 260
    };
  }

  function drawLeafParticles() {
    const now = performance.now();
    for (let i = leafParticles.length - 1; i >= 0; i--) {
      const p = leafParticles[i];
      const age = now - p.birth;
      if (age >= p.life) {
        leafParticles.splice(i, 1);
        continue;
      }
      const progress = age / p.life;
      p.x += p.vx + Math.sin(age * 0.006) * 0.6;
      p.y += p.vy;
      p.rotation += p.vRot;
      p.alpha = Math.max(0, 1 - progress);

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTooltip() {
    if (!hoveredEntity) return;
    const { screenX, screenY, icon, title, hint } = hoveredEntity;

    ctx.save();
    ctx.font = 'bold 11px Quicksand, sans-serif';
    const label = `${icon} ${title}`;
    const sub = hint;
    const labelWidth = ctx.measureText(label).width;
    ctx.font = '10px Quicksand, sans-serif';
    const subWidth = ctx.measureText(sub).width;
    const totalWidth = Math.max(labelWidth, subWidth) + 18;
    const boxHeight = 32;

    const bx = screenX - totalWidth / 2;
    const by = screenY - boxHeight - 8;

    // Glowing rounded backdrop
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, totalWidth, boxHeight, 7);
    ctx.fill();
    ctx.stroke();

    // Downward arrow pointer
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.beginPath();
    ctx.moveTo(screenX - 4, by + boxHeight);
    ctx.lineTo(screenX + 4, by + boxHeight);
    ctx.lineTo(screenX, by + boxHeight + 4);
    ctx.closePath();
    ctx.fill();

    // Title
    ctx.font = 'bold 11px Quicksand, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(label, bx + 9, by + 14);

    // Action Hint
    ctx.font = '10px Quicksand, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(sub, bx + 9, by + 26);

    ctx.restore();
  }

  function drawRoomTransition() {
    if (roomTransition.phase === 'idle') return;
    const now = performance.now();
    const elapsed = now - roomTransition.startTime;
    const progress = Math.min(1, elapsed / roomTransition.duration);

    if (roomTransition.phase === 'out') {
      roomTransition.alpha = progress;
      if (progress >= 1) {
        roomTransition.alpha = 1;
      }
    } else if (roomTransition.phase === 'in') {
      roomTransition.alpha = 1 - progress;
      if (progress >= 1) {
        roomTransition.phase = 'idle';
        roomTransition.alpha = 0;
        return;
      }
    }

    if (roomTransition.alpha <= 0) return;

    ctx.save();
    ctx.fillStyle = `rgba(15, 23, 42, ${roomTransition.alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (roomTransition.alpha > 0.35) {
      const textAlpha = Math.min(1, (roomTransition.alpha - 0.35) / 0.65);
      ctx.globalAlpha = textAlpha;

      const midX = canvas.width / 2;
      const midY = canvas.height / 2;

      ctx.font = '32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🚪', midX, midY - 12);

      ctx.font = 'bold 16px Outfit, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`Entering ${roomTransition.targetName}...`, midX, midY + 22);

      ctx.font = '12px Quicksand, sans-serif';
      ctx.fillStyle = '#a78bfa';
      ctx.fillText('✨ Loading Sanctuary ✨', midX, midY + 42);
    }
    ctx.restore();
  }

  function spawnEmoteHearts(gx, gy) {
    const pt = toScreen(gx, gy);
    for (let i = 0; i < 7; i++) {
      floatingHearts.push({
        x: pt.x + (Math.random() - 0.5) * 30,
        y: pt.y - 40 + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 40,
        vy: -40 - Math.random() * 50,
        scale: 0.8 + Math.random() * 0.6,
        alpha: 1.0,
        life: 1.8 + Math.random() * 0.5,
        maxLife: 1.8 + Math.random() * 0.5
      });
    }
  }

  function renderFloatingHearts() {
    for (let i = floatingHearts.length - 1; i >= 0; i--) {
      const h = floatingHearts[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, h.alpha);
      ctx.font = `${Math.round(18 * h.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💖', h.x, h.y);
      ctx.restore();
    }
  }

  // ==========================================================================
  // Isometric Drawing Helpers
  // ==========================================================================
  const WALL_HEIGHT = 110;

  function drawIsometricFloor() {
    const isPlaza = currentRoom.id === 'plaza' || !currentRoom.id.startsWith('loft_');
    const isLoft = currentRoom.id.startsWith('loft_');
    const flooring = currentRoom.flooring || (isLoft ? 'parquet' : 'marble');
    const wallpaper = currentRoom.wallpaper || (isLoft ? 'cozy_wood' : 'slate');

    // 1. Draw North-West Wall (y = 0 along x = 0..GRID_SIZE)
    drawNorthWestWall(wallpaper);

    // 2. Draw North-East Wall (x = 0 along y = 0..GRID_SIZE)
    drawNorthEastWall(wallpaper);

    // 3. Draw Floor Tiles
    for (let x = 0; x < getRoomGridWidth(); x++) {
      for (let y = 0; y < getRoomGridHeight(); y++) {
        const pt = toScreen(x, y);

        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x + TILE_WIDTH / 2, pt.y + TILE_HEIGHT / 2);
        ctx.lineTo(pt.x, pt.y + TILE_HEIGHT);
        ctx.lineTo(pt.x - TILE_WIDTH / 2, pt.y + TILE_HEIGHT / 2);
        ctx.closePath();

        // Check if this tile is the interactive doorway
        const isDoorTile = (x === Math.floor(getRoomGridWidth() / 2) && y === 0);

        if (isDoorTile) {
          ctx.fillStyle = '#f59e0b';
        } else if (flooring === 'marble') {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#1e293b' : '#334155';
        } else if (flooring === 'parquet') {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#78350f' : '#92400e';
        } else if (flooring === 'plush_carpet') {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#4c1d95' : '#581c87';
        } else if (flooring === 'slate') {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#0f172a' : '#1e293b';
        } else {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#1e293b' : '#334155';
        }
        ctx.fill();

        // Grid lines (highlighted in edit mode)
        ctx.strokeStyle = editMode && isLoft ? 'rgba(168, 85, 247, 0.4)' : 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 4. Draw Interactive Doorway Frame at (center, 0)
    drawInteractiveDoorway();
  }

  function drawNorthWestWall(wallpaper) {
    let topColor = '#3b4252';
    let bottomColor = '#2e3440';
    let baseboardColor = '#1e222a';

    if (wallpaper === 'cozy_wood') {
      topColor = '#451a03';
      bottomColor = '#2d1102';
      baseboardColor = '#1a0a01';
    } else if (wallpaper === 'brick') {
      topColor = '#7c2d12';
      bottomColor = '#431407';
      baseboardColor = '#270a04';
    } else if (wallpaper === 'pastel') {
      topColor = '#701a75';
      bottomColor = '#4a044e';
      baseboardColor = '#2e0231';
    }

    for (let x = 0; x < getRoomGridWidth(); x++) {
      const p0 = toScreen(x, 0);
      const p1 = toScreen(x + 1, 0);

      // Wall quad (vertical extrusion upwards)
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x, p1.y - WALL_HEIGHT);
      ctx.lineTo(p0.x, p0.y - WALL_HEIGHT);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, p0.y - WALL_HEIGHT, 0, p0.y);
      grad.addColorStop(0, topColor);
      grad.addColorStop(1, bottomColor);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Baseboard trim
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x, p1.y - 11);
      ctx.lineTo(p0.x, p0.y - 11);
      ctx.closePath();
      ctx.fillStyle = baseboardColor;
      ctx.fill();
    }
  }

  function drawNorthEastWall(wallpaper) {
    let topColor = '#2e3440';
    let bottomColor = '#1f232a';
    let baseboardColor = '#15181d';

    if (wallpaper === 'cozy_wood') {
      topColor = '#361402';
      bottomColor = '#200c01';
      baseboardColor = '#120600';
    } else if (wallpaper === 'brick') {
      topColor = '#5c1d09';
      bottomColor = '#310d05';
      baseboardColor = '#1c0702';
    } else if (wallpaper === 'pastel') {
      topColor = '#551259';
      bottomColor = '#340337';
      baseboardColor = '#1f0121';
    }

    for (let y = 0; y < getRoomGridHeight(); y++) {
      const p0 = toScreen(0, y);
      const p1 = toScreen(0, y + 1);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x, p1.y - WALL_HEIGHT);
      ctx.lineTo(p0.x, p0.y - WALL_HEIGHT);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, p0.y - WALL_HEIGHT, 0, p0.y);
      grad.addColorStop(0, topColor);
      grad.addColorStop(1, bottomColor);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Baseboard trim
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x, p1.y - 11);
      ctx.lineTo(p0.x, p0.y - 11);
      ctx.closePath();
      ctx.fillStyle = baseboardColor;
      ctx.fill();
    }
  }

  function drawInteractiveDoorway() {
    const doorX = Math.floor(getRoomGridWidth() / 2);
    const p0 = toScreen(doorX, 0);
    const p1 = toScreen(doorX + 1, 0);
    const doorHeight = 88;

    // Doorway opening on North-West wall
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p1.x, p1.y - doorHeight);
    ctx.lineTo(p0.x, p0.y - doorHeight);
    ctx.closePath();

    // Portal gradient glow
    const portalGrad = ctx.createLinearGradient(0, p0.y - doorHeight, 0, p0.y);
    portalGrad.addColorStop(0, '#0f172a');
    portalGrad.addColorStop(1, '#6366f1');
    ctx.fillStyle = portalGrad;
    ctx.fill();

    // Golden frame border
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Doorway sign badge
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2 - doorHeight - 16;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.beginPath();
    ctx.roundRect(midX - 44, midY - 11, 88, 22, 11);
    ctx.fill();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = 'bold 11px Quicksand, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const isLoft = currentRoom.id.startsWith('loft_');
    ctx.fillText(isLoft ? '🚪 PLAZA' : '🚪 MY LOFT', midX, midY);
    ctx.restore();
  }

  function drawTargetRipple(t) {
    const pt = toScreen(t.x, t.y);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(pt.x, pt.y + TILE_HEIGHT / 2, 24, 12, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(168, 85, 247, ${t.alpha})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawAmbientLighting() {
    const lights = currentRoom.furniture.filter(f => {
      const isLight = f.type === 'neon' || f.type === 'tv' || f.type === 'lamp' || f.type === 'neon_foundry_lamp';
      return isLight && (f.state?.isOn ?? true);
    });

    if (lights.length === 0) return;

    ctx.save();
    for (const f of lights) {
      const pt = toScreen(f.x, f.y);
      const cx = pt.x;
      const cy = pt.y + TILE_HEIGHT / 2 - (f.elevation || 0) * 28 - 20;
      const radius = f.type === 'neon' ? 140 : f.type === 'tv' ? 120 : f.type === 'neon_foundry_lamp' ? 150 : 130;
      const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, radius);
      if (f.type === 'neon') {
        grad.addColorStop(0, 'rgba(236, 72, 153, 0.28)');
      } else if (f.type === 'tv') {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.26)');
      } else if (f.type === 'neon_foundry_lamp') {
        grad.addColorStop(0, 'rgba(6, 182, 212, 0.32)');
      } else {
        grad.addColorStop(0, 'rgba(253, 224, 71, 0.30)');
      }
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // Volumetric 3D Isometric Solids & Procedural Lighting Helpers
  // --------------------------------------------------------------------------
  function drawIsoBox(ctx, cx, cy, opt) {
    const hw = opt.hw || 16;
    const hd = opt.hd || 8;
    const h = opt.h || 12;

    // Contact drop shadow on floor
    if (opt.shadow) {
      ctx.save();
      const sScale = opt.shadowScale || 1.0;
      ctx.beginPath();
      ctx.ellipse(cx, cy + hd * 0.35, hw * 1.15 * sScale, hd * 0.85 * sScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = opt.shadowColor || 'rgba(0, 0, 0, 0.28)';
      ctx.fill();
      ctx.restore();
    }

    // Left vertical face (South-West: diffuse fill light)
    ctx.fillStyle = opt.leftColor || '#475569';
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy - h);
    ctx.lineTo(cx, cy - h + hd);
    ctx.lineTo(cx, cy + hd);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fill();
    if (opt.stroke) {
      ctx.strokeStyle = opt.stroke;
      ctx.lineWidth = opt.lineWidth || 1;
      ctx.stroke();
    }

    // Right vertical face (South-East: core shadow & ambient occlusion)
    ctx.fillStyle = opt.rightColor || '#1e293b';
    ctx.beginPath();
    ctx.moveTo(cx, cy - h + hd);
    ctx.lineTo(cx + hw, cy - h);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hd);
    ctx.closePath();
    ctx.fill();
    if (opt.stroke) {
      ctx.strokeStyle = opt.stroke;
      ctx.lineWidth = opt.lineWidth || 1;
      ctx.stroke();
    }

    // Top horizontal face (Diamond at z = h: overhead key highlight)
    ctx.fillStyle = opt.topColor || '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - h - hd);
    ctx.lineTo(cx + hw, cy - h);
    ctx.lineTo(cx, cy - h + hd);
    ctx.lineTo(cx - hw, cy - h);
    ctx.closePath();
    ctx.fill();
    if (opt.stroke) {
      ctx.strokeStyle = opt.stroke;
      ctx.lineWidth = opt.lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawIsoCylinder(ctx, cx, cy, opt) {
    const rx = opt.rx || 14;
    const ry = opt.ry || 7;
    const h = opt.h || 14;

    if (opt.shadow) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.35, rx * 1.15, ry * 0.9, 0, 0, Math.PI * 2);
      ctx.fillStyle = opt.shadowColor || 'rgba(0, 0, 0, 0.28)';
      ctx.fill();
      ctx.restore();
    }

    // Curved body with directional horizontal lighting
    const bodyGrad = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    bodyGrad.addColorStop(0, opt.leftColor || '#475569');
    bodyGrad.addColorStop(0.35, opt.midColor || opt.topColor || '#64748b');
    bodyGrad.addColorStop(1, opt.rightColor || '#1e293b');

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - h);
    ctx.ellipse(cx, cy - h, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, false);
    ctx.lineTo(cx - rx, cy - h);
    ctx.closePath();
    ctx.fill();

    // Top cap
    ctx.fillStyle = opt.topColor || '#94a3b8';
    ctx.beginPath();
    ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (opt.stroke) {
      ctx.strokeStyle = opt.stroke;
      ctx.lineWidth = opt.lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawFurniture(f) {
    const pt = toScreen(f.x, f.y);
    const cx = pt.x;
    // Elevation offsets the furniture upward (z-ordering for multi-layer)
    const elevationOffset = (f.elevation || 0) * 28;
    const cy = pt.y + TILE_HEIGHT / 2 - elevationOffset;

    ctx.save();
    if (f.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate((f.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    switch (f.type) {
      case 'sofa': {
        // Modern Cozy Velvet Sofa (Volumetric 3D)
        // 1. Soft ground contact shadow
        drawIsoBox(ctx, cx, cy, { hw: 40, hd: 20, h: 0, shadow: true, shadowScale: 1.1 });
        // 2. Brass tapered corner legs
        drawIsoBox(ctx, cx - 28, cy + 2, { hw: 3, hd: 2, h: 6, topColor: '#fbbf24', leftColor: '#d97706', rightColor: '#92400e' });
        drawIsoBox(ctx, cx + 28, cy + 2, { hw: 3, hd: 2, h: 6, topColor: '#fbbf24', leftColor: '#d97706', rightColor: '#92400e' });
        drawIsoBox(ctx, cx - 28, cy - 14, { hw: 3, hd: 2, h: 6, topColor: '#fbbf24', leftColor: '#d97706', rightColor: '#92400e' });
        drawIsoBox(ctx, cx + 28, cy - 14, { hw: 3, hd: 2, h: 6, topColor: '#fbbf24', leftColor: '#d97706', rightColor: '#92400e' });
        // 3. Wooden base plinth
        drawIsoBox(ctx, cx, cy - 4, { hw: 36, hd: 18, h: 6, topColor: '#312e81', leftColor: '#25216d', rightColor: '#1e1b4b' });
        // 4. Velvet seat cushion
        drawIsoBox(ctx, cx, cy - 10, { hw: 34, hd: 16, h: 10, topColor: '#6366f1', leftColor: '#4f46e5', rightColor: '#3730a3', stroke: 'rgba(255,255,255,0.12)' });
        // Cushion dividing seam
        ctx.strokeStyle = '#3730a3';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy - 10);
        ctx.stroke();
        // 5. Plush high backrest
        drawIsoBox(ctx, cx, cy - 20, { hw: 34, hd: 7, h: 22, topColor: '#4f46e5', leftColor: '#4338ca', rightColor: '#312e81' });
        // Tufting button indents
        for (let bx = -22; bx <= 22; bx += 11) {
          ctx.fillStyle = '#25216d';
          ctx.beginPath(); ctx.arc(cx + bx, cy - 30, 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#818cf8';
          ctx.beginPath(); ctx.arc(cx + bx, cy - 31, 1, 0, Math.PI * 2); ctx.fill();
        }
        // 6. Left and right velvet armrests
        drawIsoBox(ctx, cx - 28, cy - 12, { hw: 7, hd: 15, h: 18, topColor: '#818cf8', leftColor: '#6366f1', rightColor: '#4338ca' });
        drawIsoBox(ctx, cx + 28, cy - 12, { hw: 7, hd: 15, h: 18, topColor: '#818cf8', leftColor: '#6366f1', rightColor: '#4338ca' });
        // 7. Accent throw pillow
        drawIsoBox(ctx, cx + 18, cy - 15, { hw: 6, hd: 6, h: 9, topColor: '#fbbf24', leftColor: '#f59e0b', rightColor: '#d97706' });
        break;
      }
      case 'steampunk_sofa': {
        // Distressed Oxblood Leather Steampunk Chesterfield (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 42, hd: 21, h: 0, shadow: true, shadowScale: 1.15 });
        // Cast brass feet
        drawIsoBox(ctx, cx - 30, cy + 2, { hw: 3.5, hd: 2.5, h: 6, topColor: '#f59e0b', leftColor: '#d97706', rightColor: '#92400e' });
        drawIsoBox(ctx, cx + 30, cy + 2, { hw: 3.5, hd: 2.5, h: 6, topColor: '#f59e0b', leftColor: '#d97706', rightColor: '#92400e' });
        // Base mahogany plinth
        drawIsoBox(ctx, cx, cy - 4, { hw: 38, hd: 19, h: 7, topColor: '#451a03', leftColor: '#2d1102', rightColor: '#1c0a00' });
        // Leather seat
        drawIsoBox(ctx, cx, cy - 11, { hw: 36, hd: 17, h: 11, topColor: '#9a3412', leftColor: '#7c2d12', rightColor: '#531e0b', stroke: 'rgba(245, 158, 11, 0.2)' });
        // Deep tufted backrest
        drawIsoBox(ctx, cx, cy - 22, { hw: 36, hd: 8, h: 24, topColor: '#7c2d12', leftColor: '#531e0b', rightColor: '#361306' });
        // Brass rivets along backrest and welt
        for (let bx = -26; bx <= 26; bx += 10) {
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath(); ctx.arc(cx + bx, cy - 32, 2, 0, Math.PI * 2); ctx.fill();
        }
        // Heavy brass rolled armrests
        drawIsoBox(ctx, cx - 30, cy - 13, { hw: 8, hd: 16, h: 20, topColor: '#d97706', leftColor: '#b45309', rightColor: '#78350f' });
        drawIsoBox(ctx, cx + 30, cy - 13, { hw: 8, hd: 16, h: 20, topColor: '#d97706', leftColor: '#b45309', rightColor: '#78350f' });
        // Copper steam pipe detail running behind the backrest
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(cx - 32, cy - 42); ctx.lineTo(cx + 32, cy - 42);
        ctx.stroke();
        // Mini pressure gauge
        ctx.fillStyle = '#fef08a';
        ctx.beginPath(); ctx.arc(cx, cy - 44, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#78350f'; ctx.lineWidth = 1; ctx.stroke();
        break;
      }
      case 'table': {
        // Solid Oak Coffee Table (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 32, hd: 18, h: 0, shadow: true, shadowScale: 1.1 });
        // 4 Turned wooden legs
        drawIsoBox(ctx, cx - 20, cy + 3, { hw: 3, hd: 2, h: 18, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        drawIsoBox(ctx, cx + 20, cy + 3, { hw: 3, hd: 2, h: 18, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        drawIsoBox(ctx, cx - 20, cy - 11, { hw: 3, hd: 2, h: 18, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        drawIsoBox(ctx, cx + 20, cy - 11, { hw: 3, hd: 2, h: 18, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        // Wood apron under-frame
        drawIsoBox(ctx, cx, cy - 15, { hw: 26, hd: 14, h: 3, topColor: '#92400e', leftColor: '#78350f', rightColor: '#451a03' });
        // Chamfered solid oak tabletop
        drawIsoBox(ctx, cx, cy - 18, { hw: 30, hd: 16, h: 5, topColor: '#d97706', leftColor: '#b45309', rightColor: '#78350f', stroke: 'rgba(255, 255, 255, 0.15)' });
        // Woodgrain grain lines on top face
        ctx.strokeStyle = 'rgba(254, 243, 199, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 22); ctx.lineTo(cx + 8, cy - 18);
        ctx.moveTo(cx - 8, cy - 25); ctx.lineTo(cx + 16, cy - 21);
        ctx.stroke();
        // Ceramic coffee mug on top
        drawIsoCylinder(ctx, cx - 6, cy - 23, { rx: 3.5, ry: 1.8, h: 5, topColor: '#f8fafc', leftColor: '#cbd5e1', rightColor: '#94a3b8' });
        break;
      }
      case 'reclaimed_wood_table': {
        // Heavy Industrial Reclaimed Timber Table (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 36, hd: 20, h: 0, shadow: true, shadowScale: 1.15 });
        // Cast iron trestle leg frames
        drawIsoBox(ctx, cx - 22, cy - 1, { hw: 3.5, hd: 14, h: 20, topColor: '#334155', leftColor: '#1e293b', rightColor: '#0f172a' });
        drawIsoBox(ctx, cx + 22, cy - 1, { hw: 3.5, hd: 14, h: 20, topColor: '#334155', leftColor: '#1e293b', rightColor: '#0f172a' });
        // Thick distressed timber slab top
        drawIsoBox(ctx, cx, cy - 20, { hw: 34, hd: 18, h: 7, topColor: '#78350f', leftColor: '#572607', rightColor: '#3b1802', stroke: '#270e02' });
        // Plank seams & wrought iron strap brackets
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy - 29); ctx.lineTo(cx - 12, cy - 19);
        ctx.moveTo(cx + 12, cy - 29); ctx.lineTo(cx + 12, cy - 19);
        ctx.stroke();
        // Corner iron brackets
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - 30, cy - 24, 5, 5);
        ctx.fillRect(cx + 25, cy - 24, 5, 5);
        break;
      }
      case 'plant': {
        // Monstera Deliciosa in Ceramic Planter (Volumetric 3D)
        let wobbleX = 0;
        if (f.wobbleStart) {
          const wobbleAge = (performance.now() - f.wobbleStart) / 450;
          if (wobbleAge >= 1) {
            delete f.wobbleStart;
          } else {
            wobbleX = Math.sin(wobbleAge * Math.PI * 6) * (1 - wobbleAge) * 6;
          }
        }
        // Terracotta ceramic pot
        drawIsoCylinder(ctx, cx, cy, { rx: 15, ry: 7.5, h: 20, shadow: true, topColor: '#b45309', leftColor: '#9a3412', midColor: '#b45309', rightColor: '#7c2d12', stroke: '#78350f' });
        // Potting soil layer
        ctx.fillStyle = '#271004';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 20, 13, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Stems & Leaves
        ctx.strokeStyle = '#065f46';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 20); ctx.quadraticCurveTo(cx - 10 + wobbleX, cy - 35, cx - 14 + wobbleX, cy - 46);
        ctx.moveTo(cx, cy - 20); ctx.quadraticCurveTo(cx + 10 + wobbleX, cy - 35, cx + 15 + wobbleX, cy - 48);
        ctx.moveTo(cx, cy - 20); ctx.lineTo(cx + wobbleX, cy - 54);
        ctx.stroke();
        // Left Monstera Leaf
        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.ellipse(cx - 15 + wobbleX, cy - 42, 14, 20, -0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.ellipse(cx - 13 + wobbleX, cy - 43, 10, 16, -0.45, 0, Math.PI * 2);
        ctx.fill();
        // Right Monstera Leaf
        ctx.fillStyle = '#047857';
        ctx.beginPath();
        ctx.ellipse(cx + 15 + wobbleX, cy - 44, 14, 20, 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.ellipse(cx + 13 + wobbleX, cy - 45, 10, 16, 0.45, 0, Math.PI * 2);
        ctx.fill();
        // Top Majestic Central Leaf
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.ellipse(cx + wobbleX, cy - 52, 16, 22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.ellipse(cx + wobbleX, cy - 54, 11, 17, 0, 0, Math.PI * 2);
        ctx.fill();
        // Center vein
        ctx.strokeStyle = '#a7f3d0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + wobbleX, cy - 40); ctx.lineTo(cx + wobbleX, cy - 64);
        ctx.stroke();
        break;
      }
      case 'tv': {
        // Retro CRT Television (Volumetric 3D)
        const isOn = f.state?.isOn ?? true;
        drawIsoBox(ctx, cx, cy, { hw: 26, hd: 16, h: 0, shadow: true, shadowScale: 1.1 });
        // 4 Wooden legs
        drawIsoBox(ctx, cx - 16, cy + 2, { hw: 2.5, hd: 2, h: 10, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        drawIsoBox(ctx, cx + 16, cy + 2, { hw: 2.5, hd: 2, h: 10, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        drawIsoBox(ctx, cx - 16, cy - 8, { hw: 2.5, hd: 2, h: 10, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        drawIsoBox(ctx, cx + 16, cy - 8, { hw: 2.5, hd: 2, h: 10, topColor: '#b45309', leftColor: '#92400e', rightColor: '#78350f' });
        // Main TV cabinet chassis
        drawIsoBox(ctx, cx, cy - 10, { hw: 24, hd: 15, h: 32, topColor: '#334155', leftColor: '#1e293b', rightColor: '#0f172a', stroke: '#020617' });
        // Front recessed screen housing
        const scrColor = isOn ? '#38bdf8' : '#090d16';
        ctx.fillStyle = scrColor;
        ctx.beginPath();
        ctx.roundRect(cx - 16, cy - 38, 24, 20, 4);
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (isOn) {
          // Phosphor glare streak
          const glare = ctx.createLinearGradient(cx - 14, cy - 36, cx + 6, cy - 20);
          glare.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
          glare.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
          glare.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = glare;
          ctx.beginPath();
          ctx.roundRect(cx - 14, cy - 36, 20, 16, 3);
          ctx.fill();
        }
        // Side control knobs
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath(); ctx.arc(cx + 12, cy - 34, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 12, cy - 26, 2.5, 0, Math.PI * 2); ctx.fill();
        // Antenna rabbit ears atop
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy - 42); ctx.lineTo(cx - 14, cy - 60);
        ctx.moveTo(cx + 3, cy - 42); ctx.lineTo(cx + 14, cy - 60);
        ctx.stroke();
        break;
      }
      case 'neon': {
        // Neon Wall Sign (Volumetric 3D Standoffs & Tubes)
        const isOn = f.state?.isOn ?? true;
        // Translucent acrylic backplate
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.beginPath();
        ctx.roundRect(cx - 38, cy - 42, 76, 28, 6);
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Standoff screws
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(cx - 34, cy - 39, 3, 3);
        ctx.fillRect(cx + 31, cy - 39, 3, 3);
        ctx.fillRect(cx - 34, cy - 19, 3, 3);
        ctx.fillRect(cx + 31, cy - 19, 3, 3);
        // Glowing Neon Typography
        if (isOn) {
          ctx.shadowColor = '#ec4899';
          ctx.shadowBlur = 18;
          ctx.fillStyle = '#f472b6';
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#475569';
        }
        ctx.font = 'bold 13px Quicksand, sans-serif';
        ctx.fillText('✨ HAVEN', cx - 30, cy - 23);
        ctx.shadowBlur = 0;
        break;
      }
      case 'lamp': {
        // Modern Brass Floor Arc Lamp (Volumetric 3D)
        const isOn = f.state?.isOn ?? true;
        // Heavy brass weighted base
        drawIsoCylinder(ctx, cx, cy, { rx: 11, ry: 5.5, h: 4, shadow: true, topColor: '#fbbf24', leftColor: '#d97706', midColor: '#fbbf24', rightColor: '#92400e' });
        // Vertical brass pole
        ctx.fillStyle = '#d97706';
        ctx.fillRect(cx - 2, cy - 44, 4, 44);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(cx - 1, cy - 44, 2, 44); // Specular streak
        // Conical lampshade
        if (isOn) {
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 18;
          ctx.fillStyle = '#fef08a';
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#94a3b8';
        }
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy - 32);
        ctx.lineTo(cx + 14, cy - 32);
        ctx.lineTo(cx + 9, cy - 52);
        ctx.lineTo(cx - 9, cy - 52);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        // Pull chain
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + 6, cy - 32); ctx.lineTo(cx + 6, cy - 24);
        ctx.stroke();
        break;
      }
      case 'neon_foundry_lamp': {
        // Industrial Foundry Reactor Lamp (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 14, hd: 9, h: 6, shadow: true, topColor: '#334155', leftColor: '#1e293b', rightColor: '#0f172a' });
        // Hazard stripes on base
        ctx.fillStyle = '#facc15';
        ctx.fillRect(cx - 6, cy - 5, 4, 3);
        ctx.fillRect(cx + 2, cy - 5, 4, 3);
        // Glass plasma chamber
        drawIsoCylinder(ctx, cx, cy - 6, { rx: 9, ry: 4.5, h: 32, topColor: '#67e8f9', leftColor: '#06b6d4', midColor: '#67e8f9', rightColor: '#0891b2' });
        // Glowing cyan energy core
        ctx.save();
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#a5f3fc';
        ctx.beginPath();
        ctx.arc(cx, cy - 22, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Protective iron cage bars
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy - 6); ctx.lineTo(cx - 7, cy - 38);
        ctx.moveTo(cx, cy - 2); ctx.lineTo(cx, cy - 34);
        ctx.moveTo(cx + 7, cy - 6); ctx.lineTo(cx + 7, cy - 38);
        ctx.stroke();
        break;
      }
      case 'arcade': {
        // Retro Arcade Cabinet (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 22, hd: 14, h: 0, shadow: true, shadowScale: 1.1 });
        // Lower pedestal chassis
        drawIsoBox(ctx, cx, cy, { hw: 20, hd: 12, h: 28, topColor: '#475569', leftColor: '#334155', rightColor: '#1e293b' });
        // Coin door
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - 8, cy - 18, 16, 12);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(cx - 5, cy - 14, 3, 4); // Coin slot 1
        ctx.fillRect(cx + 2, cy - 14, 3, 4); // Coin slot 2
        // Control panel shelf protruding forward
        drawIsoBox(ctx, cx, cy - 28, { hw: 22, hd: 10, h: 6, topColor: '#9333ea', leftColor: '#7e22ce', rightColor: '#581c87' });
        // Dual joysticks & action buttons
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(cx - 10, cy - 34, 3, 0, Math.PI * 2); ctx.fill(); // Left joystick ball
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(cx + 6, cy - 34, 3, 0, Math.PI * 2); ctx.fill(); // Right joystick ball
        ctx.fillStyle = '#facc15';
        ctx.beginPath(); ctx.arc(cx - 2, cy - 35, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 14, cy - 35, 1.8, 0, Math.PI * 2); ctx.fill();
        // Slanted upper housing & screen
        drawIsoBox(ctx, cx, cy - 34, { hw: 20, hd: 10, h: 28, topColor: '#7e22ce', leftColor: '#6b21a8', rightColor: '#3b0764' });
        // Screen bezel & display
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - 14, cy - 54, 28, 18);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(cx - 11, cy - 52, 22, 14); // Glowing game screen
        // Pixel spaceship on screen
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(cx - 2, cy - 47, 4, 4);
        // Backlit Marquee Header
        ctx.fillStyle = '#facc15';
        ctx.fillRect(cx - 16, cy - 64, 32, 8);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HAVEN', cx, cy - 58);
        break;
      }
      case 'fountain': {
        // Plaza Multi-Tier Stone Fountain (Volumetric 3D)
        // Lower wide stone basin
        drawIsoCylinder(ctx, cx, cy, { rx: 46, ry: 23, h: 12, shadow: true, topColor: '#64748b', leftColor: '#475569', midColor: '#64748b', rightColor: '#334155', stroke: '#1e293b' });
        // Lower basin water surface with caustic ripples
        const waterT = performance.now() / 400;
        const waterGrad = ctx.createRadialGradient(cx, cy - 12, 4, cx, cy - 12, 38);
        waterGrad.addColorStop(0, '#67e8f9');
        waterGrad.addColorStop(1, '#0284c7');
        ctx.fillStyle = waterGrad;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 12, 42, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        // Center pedestal
        drawIsoCylinder(ctx, cx, cy - 12, { rx: 14, ry: 7, h: 16, topColor: '#94a3b8', leftColor: '#64748b', midColor: '#94a3b8', rightColor: '#475569' });
        // Upper bowl basin
        drawIsoCylinder(ctx, cx, cy - 28, { rx: 24, ry: 12, h: 8, topColor: '#38bdf8', leftColor: '#475569', midColor: '#64748b', rightColor: '#334155' });
        // Animated water jet & splashing droplets
        ctx.fillStyle = '#e0f2fe';
        const splash = Math.sin(waterT * 3) * 4;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 42 + splash * 0.4, 4, 8 + splash, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let d = 0; d < 4; d++) {
          const dropAngle = waterT * 2 + (d * Math.PI) / 2;
          const dx = Math.cos(dropAngle) * 12;
          const dy = Math.sin(dropAngle) * 6;
          ctx.fillRect(cx + dx, cy - 34 + dy, 2.5, 2.5);
        }
        break;
      }
      case 'bench': {
        // Cast-Iron & Teak Garden Bench (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 28, hd: 14, h: 0, shadow: true, shadowScale: 1.1 });
        // Cast iron scrollwork ends
        drawIsoBox(ctx, cx - 22, cy, { hw: 3, hd: 12, h: 14, topColor: '#334155', leftColor: '#1e293b', rightColor: '#0f172a' });
        drawIsoBox(ctx, cx + 22, cy, { hw: 3, hd: 12, h: 14, topColor: '#334155', leftColor: '#1e293b', rightColor: '#0f172a' });
        // Teak seat slats
        for (let s = 0; s < 3; s++) {
          drawIsoBox(ctx, cx, cy - 14 - s * 3 + s * 2, { hw: 24, hd: 3, h: 3, topColor: '#d97706', leftColor: '#b45309', rightColor: '#78350f' });
        }
        // Teak backrest slats
        for (let b = 0; b < 2; b++) {
          drawIsoBox(ctx, cx, cy - 22 - b * 6, { hw: 24, hd: 2.5, h: 4, topColor: '#d97706', leftColor: '#b45309', rightColor: '#78350f' });
        }
        break;
      }
      case 'bed': {
        // Luxury Platform Bed (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 38, hd: 28, h: 0, shadow: true, shadowScale: 1.12 });
        // Tall dark oak headboard
        drawIsoBox(ctx, cx, cy - 16, { hw: 36, hd: 6, h: 36, topColor: '#451a03', leftColor: '#2d1102', rightColor: '#1a0a01' });
        // Platform wooden frame
        drawIsoBox(ctx, cx, cy, { hw: 36, hd: 26, h: 8, topColor: '#78350f', leftColor: '#572607', rightColor: '#3b1802' });
        // Plush memory foam mattress
        drawIsoBox(ctx, cx, cy - 8, { hw: 34, hd: 24, h: 9, topColor: '#f8fafc', leftColor: '#e2e8f0', rightColor: '#cbd5e1' });
        // Fluffy angled pillows against headboard
        drawIsoBox(ctx, cx - 14, cy - 18, { hw: 10, hd: 6, h: 6, topColor: '#ffffff', leftColor: '#f1f5f9', rightColor: '#e2e8f0' });
        drawIsoBox(ctx, cx + 14, cy - 18, { hw: 10, hd: 6, h: 6, topColor: '#ffffff', leftColor: '#f1f5f9', rightColor: '#e2e8f0' });
        // Quilted duvet comforter
        drawIsoBox(ctx, cx, cy - 14, { hw: 34, hd: 18, h: 7, topColor: '#6366f1', leftColor: '#4f46e5', rightColor: '#3730a3', stroke: 'rgba(255,255,255,0.15)' });
        // Folded back sheet hem
        ctx.fillStyle = '#e0e7ff';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 22, 28, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bookshelf': {
        // Rich Mahogany Bookshelf (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 26, hd: 12, h: 58, shadow: true, topColor: '#451a03', leftColor: '#2d1102', rightColor: '#1a0a01' });
        // Recessed inner shelf cavities
        ctx.fillStyle = '#1c0a00';
        ctx.fillRect(cx - 20, cy - 52, 40, 48);
        // 3 Shelf Dividers
        ctx.fillStyle = '#451a03';
        ctx.fillRect(cx - 21, cy - 36, 42, 4);
        ctx.fillRect(cx - 21, cy - 20, 42, 4);
        // 3D Books on shelves with varied colors and gold spine ribs
        const bookTiers = [
          { y: cy - 36, books: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899'] },
          { y: cy - 20, books: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'] },
          { y: cy - 4,  books: ['#10b981', '#a855f7', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4'] }
        ];
        bookTiers.forEach(tier => {
          tier.books.forEach((color, i) => {
            const bx = cx - 18 + i * 6;
            ctx.fillStyle = color;
            ctx.fillRect(bx, tier.y - 12, 5, 12);
            // Gold foil spine rib
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(bx, tier.y - 8, 5, 1.5);
          });
        });
        break;
      }
      case 'whiteboard': {
        // Standing Collaborative Whiteboard Easel (Volumetric 3D)
        drawIsoBox(ctx, cx, cy, { hw: 28, hd: 14, h: 0, shadow: true, shadowScale: 1.1 });
        // Aluminum A-frame legs
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy); ctx.lineTo(cx - 16, cy - 48);
        ctx.moveTo(cx + 22, cy); ctx.lineTo(cx + 16, cy - 48);
        ctx.stroke();
        // Caster wheels
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.arc(cx - 22, cy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 22, cy, 3, 0, Math.PI * 2); ctx.fill();
        // Whiteboard panel frame & surface
        drawIsoBox(ctx, cx, cy - 20, { hw: 26, hd: 4, h: 32, topColor: '#e2e8f0', leftColor: '#94a3b8', rightColor: '#64748b', stroke: '#475569' });
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cx - 22, cy - 50, 44, 28);
        // Marker tray
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(cx - 20, cy - 22, 40, 3);
        // Dry-erase markers
        ctx.fillStyle = '#3b82f6'; ctx.fillRect(cx - 12, cy - 24, 6, 2);
        ctx.fillStyle = '#ef4444'; ctx.fillRect(cx - 3, cy - 24, 6, 2);
        // Collaborative user drawing preview on board
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 42); ctx.quadraticCurveTo(cx - 4, cy - 48, cx + 14, cy - 36);
        ctx.stroke();
        break;
      }
      case 'teleporter_pad': {
        // High-Tech Sci-Fi Teleportation Dais (Volumetric 3D)
        const t = performance.now() / 250;
        const pulse = Math.sin(t) * 5;
        // Outer chamfered titanium dais
        drawIsoCylinder(ctx, cx, cy, { rx: 32, ry: 16, h: 8, shadow: true, topColor: '#0891b2', leftColor: '#0e7490', midColor: '#0891b2', rightColor: '#155e75', stroke: '#06b6d4' });
        // Recessed glowing plasma portal
        ctx.save();
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 16 + pulse;
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 8, 22, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        // Inner concentric energy ring
        ctx.strokeStyle = '#cffafe';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 8, 12, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // Floating teleport vortex particles
        ctx.fillStyle = '#67e8f9';
        for (let p = 0; p < 3; p++) {
          const pAngle = t * 1.5 + (p * Math.PI * 2) / 3;
          const px = cx + Math.cos(pAngle) * 16;
          const py = cy - 14 - p * 6 + Math.sin(pAngle) * 4;
          ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'pet_cat': {
        // 3D Expressive Companion Cat
        const bob = Math.sin(performance.now() / 280) * 2.5;
        // Contact shadow
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, 14, 7, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fill();
        ctx.restore();
        // Volumetric Cat Body
        drawIsoCylinder(ctx, cx, cy - 2 + bob, { rx: 12, ry: 8, h: 10, topColor: '#fb923c', leftColor: '#ea580c', midColor: '#f97316', rightColor: '#c2410c' });
        // Head
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(cx + 8, cy - 14 + bob, 8, 0, Math.PI * 2);
        ctx.fill();
        // Triangular ears with pink inside
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.moveTo(cx + 4, cy - 20 + bob); ctx.lineTo(cx + 8, cy - 27 + bob); ctx.lineTo(cx + 11, cy - 20 + bob);
        ctx.moveTo(cx + 9, cy - 20 + bob); ctx.lineTo(cx + 13, cy - 27 + bob); ctx.lineTo(cx + 16, cy - 20 + bob);
        ctx.fill();
        ctx.fillStyle = '#fda4af';
        ctx.beginPath();
        ctx.moveTo(cx + 6, cy - 20 + bob); ctx.lineTo(cx + 8, cy - 24 + bob); ctx.lineTo(cx + 10, cy - 20 + bob);
        ctx.fill();
        // Curled tail with bobbing tip
        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy - 6 + bob);
        ctx.quadraticCurveTo(cx - 18, cy - 18 + bob, cx - 14, cy - 24 + bob);
        ctx.stroke();
        break;
      }
      case 'pet_dog': {
        // 3D Loyal Companion Dog
        const bob = Math.sin(performance.now() / 220) * 2.5;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, 16, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fill();
        ctx.restore();
        // Volumetric Dog Body
        drawIsoCylinder(ctx, cx, cy - 3 + bob, { rx: 14, ry: 9, h: 12, topColor: '#fbbf24', leftColor: '#d97706', midColor: '#f59e0b', rightColor: '#b45309' });
        // Head & snout
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.arc(cx + 10, cy - 16 + bob, 9, 0, Math.PI * 2);
        ctx.fill();
        // Floppy ears
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.ellipse(cx + 8, cy - 14 + bob, 4, 8, 0.4, 0, Math.PI * 2);
        ctx.ellipse(cx + 15, cy - 14 + bob, 4, 8, -0.4, 0, Math.PI * 2);
        ctx.fill();
        // Wagging tail
        const wag = Math.sin(performance.now() / 90) * 6;
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy - 8 + bob);
        ctx.lineTo(cx - 20 + wag, cy - 16 + bob);
        ctx.stroke();
        break;
      }
      case 'pet_dragon':
      case 'clockwork_pet_dragon': {
        // 3D Clockwork Mythic Dragon
        const flap = Math.sin(performance.now() / 140) * 8;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, 15, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fill();
        ctx.restore();
        // Dragon Body
        drawIsoCylinder(ctx, cx, cy - 4, { rx: 13, ry: 8, h: 12, topColor: '#f59e0b', leftColor: '#d97706', midColor: '#f59e0b', rightColor: '#92400e' });
        // Dragon Head with golden horns
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.arc(cx + 10, cy - 18, 8, 0, Math.PI * 2);
        ctx.fill();
        // Horns
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(cx + 8, cy - 22); ctx.lineTo(cx + 10, cy - 30); ctx.lineTo(cx + 13, cy - 22);
        ctx.moveTo(cx + 12, cy - 22); ctx.lineTo(cx + 15, cy - 30); ctx.lineTo(cx + 17, cy - 22);
        ctx.fill();
        // Animated wings
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(cx - 2, cy - 14);
        ctx.lineTo(cx - 16, cy - 28 + flap);
        ctx.lineTo(cx + 6, cy - 18);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  function drawAvatar(p, isSelf) {
    // Render from the interpolated position when available (smooths 20Hz deltas
    // into 60fps motion); sim position is the fallback.
    const rx = (typeof p.renderX === 'number') ? p.renderX : p.x;
    const ry = (typeof p.renderY === 'number') ? p.renderY : p.y;
    const pt = toScreen(rx, ry);
    const cx = pt.x;
    const cy = pt.y + TILE_HEIGHT / 2;

    const av = p.avatar || selfPlayer.avatar;
    const isSitting = !!p.isSitting;
    const facing = p.facing || 'SE';
    const bounce = (!isSitting && p.isWalking) ? getWalkBob(p.walkCycle || 0, 3.5) : 0;

    let jumpOffsetY = 0;
    let waveAngle = 0;
    let danceOffsetX = 0;
    let danceOffsetY = 0;

    if (p.activeEmote) {
      const now = performance.now();
      const elapsed = now - p.activeEmote.startTime;
      const progress = elapsed / p.activeEmote.duration;
      if (progress >= 1) {
        p.activeEmote = null;
      } else {
        if (p.activeEmote.type === 'jump') {
          jumpOffsetY = computeJumpOffset(progress, 26);
        } else if (p.activeEmote.type === 'wave') {
          waveAngle = computeWaveAngle(progress, 0.45);
        } else if (p.activeEmote.type === 'dance') {
          const d = computeDanceOffset(progress, 8);
          danceOffsetX = d.x;
          danceOffsetY = d.y;
        } else if (p.activeEmote.type === 'hug' || p.activeEmote.type === 'heart') {
          danceOffsetY = -Math.abs(Math.sin(progress * Math.PI * 3)) * 5;
        }
      }
    }

    const charX = cx + danceOffsetX;
    const baseY = cy - (isSitting ? 4 : 10) + bounce + jumpOffsetY + danceOffsetY;

    // Render scaled avatar
    ctx.save();
    ctx.translate(charX, baseY);
    ctx.scale(1.35, 1.35);

    // Emote poses (dance/run/lie) override locomotion so every documented frame
    // set is reachable in-world; explicit p.pose still wins for forced poses.
    const emotePose = p.activeEmote && POSE_EMOTES.includes(p.activeEmote.type) ? p.activeEmote.type : null;
    const pose = p.pose || emotePose || (isSitting ? 'sit' : p.isWalking ? 'walk' : 'idle');
    drawModularAvatar(ctx, av, 0, 0, { pose, facing, time: performance.now(), wave: waveAngle });
    p.auraState ||= {};
    const auraNow = performance.now();
    drawAura(ctx, p.auraState, av.aura || 'none', 0, 0, (auraNow - (p.auraAt || auraNow)) / 1000);
    p.auraAt = auraNow;
    ctx.restore();

    // Name Tag — Persistently synchronized above scaled avatar
    ctx.save();
    ctx.font = 'bold 11px Quicksand, sans-serif';
    const titleLabel = TITLES[p.title]?.label;
    const tagText = `${titleLabel ? `[${titleLabel}] ` : ''}${(isSelf ? selfPlayer.name : p.name) || 'Traveler'}`;
    const textWidth = ctx.measureText(tagText).width;

    ctx.fillStyle = isSelf ? 'rgba(139, 92, 246, 0.90)' : 'rgba(15, 23, 42, 0.82)';
    ctx.beginPath();
    ctx.roundRect(charX - textWidth / 2 - 6, (isSitting ? baseY - 66 : baseY - 78), textWidth + 12, 18, 9);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(tagText, charX - textWidth / 2, (isSitting ? baseY - 53 : baseY - 65));
    ctx.restore();
  }

  function drawSpeechBubble(p) {
    if (!p.lastChat) return;
    const age = (Date.now() - p.lastChat.timestamp) / 1000;
    if (age > 6) {
      p.lastChat = null;
      return;
    }

    let jumpOffsetY = 0;
    let danceOffsetX = 0;
    if (p.activeEmote) {
      const elapsed = performance.now() - p.activeEmote.startTime;
      const progress = elapsed / p.activeEmote.duration;
      if (progress < 1) {
        if (p.activeEmote.type === 'jump') jumpOffsetY = computeJumpOffset(progress, 26);
        else if (p.activeEmote.type === 'dance') danceOffsetX = computeDanceOffset(progress, 8).x;
      }
    }

    const alpha = fadeAlpha(age, 6, 5);
    const pt = toScreen(p.x, p.y);
    const cx = pt.x + danceOffsetX;
    const cy = pt.y + TILE_HEIGHT / 2 - 94 + jumpOffsetY;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '12px Outfit, sans-serif';

    const text = p.lastChat.text;
    const metrics = ctx.measureText(text);
    const bubbleWidth = Math.max(40, metrics.width + 16);
    const bubbleHeight = 24;

    // Bubble Background
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cx - bubbleWidth / 2, cy - bubbleHeight, bubbleWidth, bubbleHeight, 10);
    ctx.fill();

    // Small Tail
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, cy + 5);
    ctx.closePath();
    ctx.fill();

    // Bubble Text
    ctx.fillStyle = '#0f172a';
    ctx.fillText(text, cx - metrics.width / 2, cy - 8);

    ctx.restore();
  }

  // ==========================================================================
  // Controls & Event Handlers
  // ==========================================================================
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Close open context menu if clicking outside
    if (!playerContextMenu.classList.contains('hidden')) {
      playerContextMenu.classList.add('hidden');
    }

    // 1. Check if clicking on another player (Avatar Hit Test for Context Menu)
    for (const [pId, p] of otherPlayers) {
      const pt = toScreen(p.x, p.y);
      const cx = pt.x;
      const cy = pt.y + TILE_HEIGHT / 2 - 28; // center of scaled avatar torso/head
      const dx = sx - cx;
      const dy = sy - cy;
      if (Math.hypot(dx, dy) < 36) {
        // Hit detected on other player!
        openPlayerContextMenu(p, e.clientX, e.clientY);
        return;
      }
    }

    // 2. Check if clicking on the Interactive Doorway (at doorX = Math.floor(getRoomGridWidth() / 2), y = 0)
    const doorX = Math.floor(getRoomGridWidth() / 2);
    const doorPt0 = toScreen(doorX, 0);
    const doorPt1 = toScreen(doorX + 1, 0);
    const doorMidX = (doorPt0.x + doorPt1.x) / 2;
    const doorMidY = (doorPt0.y + doorPt1.y) / 2 - 44; // middle of 88px doorway frame
    if (Math.hypot(sx - doorMidX, sy - doorMidY) < 48) {
      // Toggle room: if in plaza, switch to personal loft; if in loft, switch to plaza
      const isLoft = currentRoom.id.startsWith('loft_');
      let targetRoomId = 'plaza';
      let targetName = 'Central Plaza & Lounge';
      if (!isLoft) {
        const loftOption = Array.from(document.getElementById('room-select').options)
          .find(opt => opt.value.startsWith('loft_'));
        if (loftOption) {
          targetRoomId = loftOption.value;
          targetName = loftOption.textContent || 'Personal Sanctuary Loft';
        }
      }
      startRoomTransition(targetName);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'SWITCH_ROOM',
          payload: { roomId: targetRoomId }
        }));
      }
      return;
    }

    const grid = toGrid(sx, sy);
    if (grid.x < -0.5 || grid.x > getRoomGridWidth() + 0.5 || grid.y < -0.5 || grid.y > getRoomGridHeight() + 0.5) return;

    // Gentle clamp within the playable grid
    const targetX = Math.max(0.5, Math.min(getRoomGridWidth() - 0.5, grid.x));
    const targetY = Math.max(0.5, Math.min(getRoomGridHeight() - 0.5, grid.y));

    const isPersonalLoft = currentRoom.id.startsWith('loft_');

    if (editMode && isPersonalLoft) {
      // Check if clicking on existing furniture (surface parenting)
      const clickedFurniture = currentRoom.furniture.find(f => {
        if (f.elevation && f.elevation > 0) return false; // Skip elevated items
        if (f.parentSurfaceId) return false; // Skip items already on a surface
        const pt = toScreen(f.x, f.y);
        const cx = pt.x;
        const cy = pt.y + TILE_HEIGHT / 2;
        const dx = sx - cx;
        const dy = sy - cy;
        return Math.hypot(dx, dy) < 42; // Approx click radius
      });

      if (clickedFurniture && !parentSurfaceId) {
        // Select this furniture as a parent surface
        parentSurfaceId = clickedFurniture.id;
        targetIndicator = { x: targetX, y: targetY, alpha: 1.0, parentSurface: clickedFurniture.id };
        return; // Don't place yet — now in "place on surface" mode
      }

      // Place furniture with rotation
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'PLACE_FURNITURE',
          payload: {
            type: selectedFurnitureType,
            x: targetX,
            y: targetY,
            elevation: parentSurfaceId ? 1 : 0,
            parentSurfaceId: parentSurfaceId || null,
            rotation: currentFurniRotation || 0
          }
        }));
      }
      // Clear parent surface selection after placing
      if (parentSurfaceId) parentSurfaceId = null;
    } else {
      // Check interactive furniture hit test (seating, toggles, whiteboard, teleporter, pets)
      const clickedFurniture = currentRoom.furniture.slice().reverse().find(f => {
        const pt = toScreen(f.x, f.y);
        const cx = pt.x;
        const cy = pt.y + TILE_HEIGHT / 2 - (f.elevation || 0) * 28;
        const dx = sx - cx;
        const dy = sy - cy;
        return Math.hypot(dx, dy) < 38;
      });

      if (clickedFurniture) {
        if (clickedFurniture.type === 'plant') {
          rustlePlant(clickedFurniture);
          triggerPassportAction('RUSTLE_TREE');
          return;
        }
        if (clickedFurniture.type === 'arcade') {
          playArcadeJingle();
          return;
        }
        if (clickedFurniture.type === 'whiteboard') {
          openWhiteboardModal();
          return;
        }
        if (clickedFurniture.type === 'teleporter_pad') {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'TELEPORT_TRIGGER',
              payload: { teleporterId: clickedFurniture.id }
            }));
          }
          playDoorwayWhoosh();
          showToast('Stepped on teleporter! 🌀', '🌀');
          return;
        }
        if (clickedFurniture.type.startsWith('pet_') || clickedFurniture.type === 'clockwork_pet_dragon') {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'PET_INTERACT',
              payload: { petId: clickedFurniture.id, action: 'pet' }
            }));
          }
          playChatPing();
          showToast('You pet your companion! ❤️', '🐾');
          return;
        }

        const seatTypes = ['sofa', 'bench', 'chair', 'stool', 'bed', 'steampunk_sofa'];
        const lightTypes = ['lamp', 'neon', 'tv', 'neon_foundry_lamp'];
        if (seatTypes.includes(clickedFurniture.type)) {
          playSitSound();
          triggerPassportAction('SIT');
          selfPlayer.targetX = clickedFurniture.x;
          selfPlayer.targetY = clickedFurniture.y;
          selfPlayer.isSitting = true;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'INTERACT_FURNITURE',
              payload: { furnitureId: clickedFurniture.id, action: 'sit' }
            }));
          }
          return;
        } else if (lightTypes.includes(clickedFurniture.type)) {
          playSwitchClick();
          triggerPassportAction('TOGGLE_LIGHT');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'INTERACT_FURNITURE',
              payload: { furnitureId: clickedFurniture.id, action: 'toggle' }
            }));
          }
          return;
        }
      }

      // Walk to position with responsive optimistic movement and network sync
      selfPlayer.isSitting = false;
      targetIndicator = { x: targetX, y: targetY, alpha: 1.0 };
      selfPlayer.targetX = targetX;
      selfPlayer.targetY = targetY;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'MOVE_REQUEST',
          payload: { targetX, targetY }
        }));
      }
    }
  });

  // Interactive In-World Hover Tooltips & Cursor State
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Check doorway hover
    const doorX = Math.floor(getRoomGridWidth() / 2);
    const doorPt0 = toScreen(doorX, 0);
    const doorPt1 = toScreen(doorX + 1, 0);
    const doorMidX = (doorPt0.x + doorPt1.x) / 2;
    const doorMidY = (doorPt0.y + doorPt1.y) / 2 - 44;
    if (Math.hypot(sx - doorMidX, sy - doorMidY) < 48) {
      const isLoft = currentRoom.id.startsWith('loft_');
      hoveredEntity = {
        type: 'door',
        screenX: doorMidX,
        screenY: doorMidY - 36,
        icon: '🚪',
        title: isLoft ? 'Central Plaza Exit' : 'Personal Loft Door',
        hint: 'Click to travel'
      };
      canvas.style.cursor = 'pointer';
      return;
    }

    // Check other players hover
    for (const [pId, p] of otherPlayers) {
      const pt = toScreen(p.x, p.y);
      const cx = pt.x;
      const cy = pt.y + TILE_HEIGHT / 2 - 28;
      if (Math.hypot(sx - cx, sy - cy) < 36) {
        const titleLabel = TITLES[p.title]?.label;
        const statusText = p.statusMessage || p.identity?.statusMessage;
        hoveredEntity = {
          type: 'player',
          screenX: cx,
          screenY: cy - 48,
          icon: '👤',
          title: `${titleLabel ? `[${titleLabel}] ` : ''}${p.name || 'Traveler'}`,
          hint: statusText ? `“${statusText}”` : 'Click to open player menu'
        };
        canvas.style.cursor = 'pointer';
        return;
      }
    }

    // Check interactive furniture hover
    const hoveredFurni = currentRoom.furniture.slice().reverse().find(f => {
      const pt = toScreen(f.x, f.y);
      const cx = pt.x;
      const cy = pt.y + TILE_HEIGHT / 2 - (f.elevation || 0) * 28;
      return Math.hypot(sx - cx, sy - cy) < 38;
    });

    if (hoveredFurni) {
      let icon = '🛋️', title = 'Decor', hint = 'Click to interact';
      if (hoveredFurni.type === 'plant') {
        icon = '🌿'; title = 'Fiddle-Leaf Plant'; hint = 'Click to rustle leaves';
      } else if (hoveredFurni.type === 'fountain') {
        icon = '⛲'; title = 'Central Fountain'; hint = 'Click to relax & fish';
      } else if (hoveredFurni.type === 'arcade') {
        icon = '🕹️'; title = 'Retro Arcade'; hint = 'Click to play chiptune';
      } else if (hoveredFurni.type === 'bench' || hoveredFurni.type === 'sofa' || hoveredFurni.type === 'chair') {
        icon = '🪑'; title = hoveredFurni.type === 'sofa' ? 'Cozy Sofa' : 'Park Bench'; hint = 'Click to sit & rest';
      } else if (hoveredFurni.type === 'tv') {
        icon = '📺'; title = 'CRT Television'; hint = 'Click to switch channel';
      } else if (hoveredFurni.type === 'neon') {
        icon = '💡'; title = 'Neon Sign'; hint = 'Click to toggle light';
      } else if (hoveredFurni.type === 'table') {
        icon = '🪵'; title = 'Wood Table'; hint = 'Click to place items';
      }

      const pt = toScreen(hoveredFurni.x, hoveredFurni.y);
      hoveredEntity = {
        type: hoveredFurni.type,
        screenX: pt.x,
        screenY: pt.y + TILE_HEIGHT / 2 - 58 - (hoveredFurni.elevation || 0) * 28,
        icon,
        title,
        hint
      };
      canvas.style.cursor = 'pointer';
      return;
    }

    hoveredEntity = null;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredEntity = null;
    canvas.style.cursor = 'default';
  });

  // Chat Submission
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'CHAT',
        payload: { text }
      }));
    }
  });

  // Quick Emotes
  document.querySelectorAll('.emote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-text') || '';
      // Trigger physical emote animation & overhead bubble locally immediately
      let emoteKey = 'jump';
      if (text.includes('👋') || text === 'wave') emoteKey = 'wave';
      else if (text.includes('💖') || text.includes('❤️') || text === 'hug') emoteKey = 'hug';
      else if (text.includes('💃') || text.includes('🔥') || text.includes('🎉') || text === 'dance') emoteKey = 'dance';
      else emoteKey = 'jump';

      triggerPlayerEmote(selfPlayer, emoteKey);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'PLAYER_EMOTE',
          payload: { emote: emoteKey, text }
        }));
      }
    });
  });

  function appendChatMessage(sender, text, category = 'normal') {
    const box = document.getElementById('chat-history');
    const msg = document.createElement('div');
    msg.className = 'chat-msg';

    if (sender === 'system' || category === 'system') {
      msg.classList.add('system');
      msg.innerHTML = `<span class="chat-badge sys">System</span> <span class="text">${escapeHtml(text)}</span>`;
    } else if (category === 'reward' || text.includes('🪙') || text.includes('HavenCoins')) {
      msg.classList.add('reward');
      msg.innerHTML = `<span class="chat-badge reward">Reward</span> <span class="text">${escapeHtml(text)}</span>`;
    } else if (category === 'whisper' || text.startsWith('[Whisper')) {
      msg.classList.add('whisper');
      msg.innerHTML = `<span class="chat-badge whisper">Whisper</span> <span class="text">${escapeHtml(text)}</span>`;
    } else {
      const isSelf = sender === selfPlayer.name;
      const badgeHtml = isSelf ? `<span class="chat-badge you">You</span> ` : '';
      msg.innerHTML = `${badgeHtml}<span class="sender ${isSelf ? 'is-self' : ''}">${escapeHtml(sender)}:</span> <span class="text">${escapeHtml(text)}</span>`;
    }

    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  function updateCoinUI(coins) {
    document.getElementById('coin-amount').textContent = coins.toLocaleString();
  }

  // ==========================================================================
  // Room Selector
  // ==========================================================================
  document.getElementById('room-select').addEventListener('change', (e) => {
    const targetRoom = e.target.value;
    const optText = e.target.selectedOptions[0]?.textContent || targetRoom;
    startRoomTransition(optText);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'SWITCH_ROOM',
        payload: { roomId: targetRoom }
      }));
    }
  });

  // ==========================================================================
  // Daily Bonus
  // ==========================================================================
  document.getElementById('btn-daily-bonus').addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CLAIM_DAILY_BONUS', payload: {} }));
    }
  });

  document.getElementById('btn-close-daily').addEventListener('click', () => {
    dailyPopup.classList.add('hidden');
  });

  // Close daily popup when clicking outside
  dailyPopup.addEventListener('click', (e) => {
    if (e.target === dailyPopup) {
      dailyPopup.classList.add('hidden');
    }
  });

  // ==========================================================================
  // Edit Mode Palette
  // ==========================================================================
  const decorPalette = document.getElementById('decor-palette');
  document.getElementById('btn-edit-mode').addEventListener('click', () => {
    if (!currentRoom.id.startsWith('loft_')) {
      // Auto-switch to personal loft
      const loftOption = Array.from(document.getElementById('room-select').options)
        .find(opt => opt.value.startsWith('loft_'));
      if (loftOption) {
        document.getElementById('room-select').value = loftOption.value;
        document.getElementById('room-select').dispatchEvent(new Event('change'));
      } else {
        alert('You need to be in your Personal Sanctuary Loft to decorate! Connect to claim your loft.');
        return;
      }
    }
    editMode = !editMode;
    if (!editMode) parentSurfaceId = null; // Reset surface parenting when exiting edit mode
    decorPalette.classList.toggle('hidden', !editMode);
  });

  document.getElementById('btn-close-decor').addEventListener('click', () => {
    editMode = false;
    decorPalette.classList.add('hidden');
  });

  document.querySelectorAll('.furniture-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.furniture-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedFurnitureType = chip.getAttribute('data-type');
    });
  });

  document.getElementById('btn-clear-room').addEventListener('click', () => {
    if (confirm('Clear all furniture in your Sanctuary Loft?')) {
      currentRoom.furniture.forEach(f => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'REMOVE_FURNITURE', payload: { id: f.id } }));
        }
      });
    }
  });

  // Flooring style selector chips
  document.querySelectorAll('#flooring-options .style-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#flooring-options .style-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const flooring = chip.getAttribute('data-flooring');
      currentRoom.flooring = flooring;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'UPDATE_ROOM_STYLE',
          payload: { roomId: currentRoom.id, flooring }
        }));
      }
    });
  });

  // Wallpaper style selector chips
  document.querySelectorAll('#wallpaper-options .style-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#wallpaper-options .style-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const wallpaper = chip.getAttribute('data-wallpaper');
      currentRoom.wallpaper = wallpaper;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'UPDATE_ROOM_STYLE',
          payload: { roomId: currentRoom.id, wallpaper }
        }));
      }
    });
  });

  // ==========================================================================
  // Account / Auth Flow
  // ==========================================================================
  document.getElementById('btn-account').addEventListener('click', () => {
    accountModal.classList.remove('hidden');
    if (authPlayerId) {
      // Already logged in — show signed-in view
      accountFormSignedOut.classList.add('hidden');
      accountFormLoggedIn.classList.remove('hidden');
    } else {
      accountFormSignedOut.classList.remove('hidden');
      accountFormLoggedIn.classList.add('hidden');
      // Default to login tab
      loginForm.classList.remove('hidden');
      signupForm.classList.add('hidden');
      document.getElementById('btn-tab-login').style.opacity = '1';
      document.getElementById('btn-tab-signup').style.opacity = '0.6';
    }
  });

  document.getElementById('btn-close-account').addEventListener('click', () => {
    accountModal.classList.add('hidden');
  });

  // Account modal close when clicking outside
  accountModal.addEventListener('click', (e) => {
    if (e.target === accountModal) {
      accountModal.classList.add('hidden');
    }
  });

  // Tab switching
  document.getElementById('btn-tab-login').addEventListener('click', () => {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    loginErrorEl.style.display = 'none';
    signupErrorEl.style.display = 'none';
  });

  document.getElementById('btn-tab-signup').addEventListener('click', () => {
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    loginErrorEl.style.display = 'none';
    signupErrorEl.style.display = 'none';
  });

  // Login form submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;
    if (!username || !password) return;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.success) {
        authToken = data.playerId;
        authPlayerId = data.playerId;
        selfId = data.playerId;
        localStorage.setItem('haven_token', data.playerId);
        showLoggedInState(data.playerId, data.name);
        appendChatMessage('system', `Welcome back, ${data.name}! Reconnecting with your saved account...`);
        // Reconnect the WebSocket with the auth token
        if (ws) ws.close();
      } else {
        loginErrorEl.textContent = data.error || 'Login failed.';
        loginErrorEl.style.display = 'block';
      }
    } catch (err) {
      loginErrorEl.textContent = 'Network error. Try again.';
      loginErrorEl.style.display = 'block';
    }
  });

  // Signup form submit
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = signupUsernameInput.value.trim();
    const password = signupPasswordInput.value;
    if (!username || !password) return;

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.success) {
        authToken = data.playerId;
        authPlayerId = data.playerId;
        selfId = data.playerId;
        localStorage.setItem('haven_token', data.playerId);
        showLoggedInState(data.playerId, data.name);
        appendChatMessage('system', `Account created! Welcome, ${data.name}! Reconnecting with your saved account...`);
        // Reconnect the WebSocket with the auth token
        if (ws) ws.close();
      } else {
        signupErrorEl.textContent = data.error || 'Signup failed.';
        signupErrorEl.style.display = 'block';
      }
    } catch (err) {
      signupErrorEl.textContent = 'Network error. Try again.';
      signupErrorEl.style.display = 'block';
    }
  });

  function showLoggedInState(playerId, playerName) {
    accountFormSignedOut.classList.add('hidden');
    accountFormLoggedIn.classList.remove('hidden');
    document.getElementById('account-player-name').textContent = playerName;
    document.getElementById('account-player-id').textContent = playerId;
  }

  // ==========================================================================
  // Wardrobe / Character Customizer Modal
  // ==========================================================================
  const avatarModal = document.getElementById('avatar-modal');
  const previewCanvas = document.getElementById('avatar-preview');
  const pctx = previewCanvas.getContext('2d');
  const syncWardrobe = mountWardrobe(previewCanvas.parentElement, () => selfPlayer.avatar,
    avatar => { selfPlayer.avatar = avatar; }, () => identityState, sendWs, renderAvatarPreview);
  function animateWardrobe() {
    if (!avatarModal.classList.contains('hidden')) renderAvatarPreview();
    requestAnimationFrame(animateWardrobe);
  }
  requestAnimationFrame(animateWardrobe);

  document.getElementById('btn-avatar').addEventListener('click', () => {
    avatarModal.classList.remove('hidden');
    document.getElementById('cust-name').value = selfPlayer.name;
    renderAvatarPreview();
  });

  document.getElementById('btn-close-avatar').addEventListener('click', () => {
    avatarModal.classList.add('hidden');
  });

  function renderAvatarPreview() {
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const cx = previewCanvas.width / 2;
    const cy = 120;
    const av = selfPlayer.avatar;

    syncWardrobe();
    pctx.save();
    pctx.translate(cx, 130); pctx.scale(2, 2);
    drawModularAvatar(pctx, av, 0, 0, { pose: document.getElementById('wardrobe-pose').value, time: performance.now() });
    pctx.restore();
  }

  // Swatch Selectors
  function setupColorPickers(containerId, avatarKey) {
    document.querySelectorAll(`#${containerId} .color-swatch`).forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll(`#${containerId} .color-swatch`).forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selfPlayer.avatar[avatarKey] = btn.getAttribute('data-color');
        renderAvatarPreview();
      });
    });
  }
  setupColorPickers('skin-tones', 'skin');
  setupColorPickers('hair-colors', 'hairColor');
  setupColorPickers('shirt-colors', 'shirtColor');

  document.getElementById('btn-save-avatar').addEventListener('click', () => {
    const newName = document.getElementById('cust-name').value.trim();
    if (newName) selfPlayer.name = newName;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'UPDATE_AVATAR',
        payload: {
          name: selfPlayer.name,
          avatar: selfPlayer.avatar
        }
      }));
    }
    avatarModal.classList.add('hidden');
  });

  // ==========================================================================
  // Pizza Chef Mini-Game
  // ==========================================================================
  const minigameModal = document.getElementById('minigame-modal');
  let pizzaTimerInterval = null;
  let pizzaSeconds = 30;
  let pizzaScore = 0;
  let currentIngredients = [];

  let activeRecipe = RECIPES[0];

  document.getElementById('btn-minigame').addEventListener('click', () => {
    minigameModal.classList.remove('hidden');
    startPizzaGame();
  });

  document.getElementById('btn-close-minigame').addEventListener('click', () => {
    clearInterval(pizzaTimerInterval);
    minigameModal.classList.add('hidden');
  });

  function startPizzaGame() {
    pizzaSeconds = 30;
    pizzaScore = 0;
    currentIngredients = [];
    document.getElementById('pizza-score').textContent = '0';
    document.getElementById('pizza-coins').textContent = '+0 Coins';
    updateAssembledDisplay();
    pickNewRecipe();

    clearInterval(pizzaTimerInterval);
    pizzaTimerInterval = setInterval(() => {
      pizzaSeconds--;
      document.getElementById('pizza-timer').textContent = `${pizzaSeconds}s`;
      if (pizzaSeconds <= 0) {
        clearInterval(pizzaTimerInterval);
        finishPizzaGame();
      }
    }, 1000);
  }

  function pickNewRecipe() {
    activeRecipe = RECIPES[Math.floor(Math.random() * RECIPES.length)];
    document.getElementById('target-recipe').textContent = activeRecipe.steps.join(' \u2794 ');
    currentIngredients = [];
    updateAssembledDisplay();
  }

  function updateAssembledDisplay() {
    const el = document.getElementById('pizza-preview-text');
    if (currentIngredients.length === 0) {
      el.textContent = 'Empty Tray';
    } else {
      el.textContent = currentIngredients.join(' + ');
    }
  }

  document.querySelectorAll('.ing-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ing = btn.getAttribute('data-ing');
      currentIngredients.push(ing);
      updateAssembledDisplay();
    });
  });

  document.getElementById('btn-reset-pizza').addEventListener('click', () => {
    currentIngredients = [];
    updateAssembledDisplay();
  });

  document.getElementById('btn-bake-pizza').addEventListener('click', () => {
    const isMatch = matchRecipe(currentIngredients, activeRecipe);

    if (isMatch) {
      pizzaScore++;
      document.getElementById('pizza-score').textContent = String(pizzaScore);
      document.getElementById('pizza-coins').textContent = `+${scoreCoins(pizzaScore)} Coins`;
      pickNewRecipe();
    } else {
      alert('Recipe mismatched! Check the ticket and try again.');
      currentIngredients = [];
      updateAssembledDisplay();
    }
  });

  function finishPizzaGame() {
    const finalCoins = scoreCoins(pizzaScore);
    alert(`Time's up! You served ${pizzaScore} delicious pizzas and earned ${finalCoins} HavenCoins!`);
    minigameModal.classList.add('hidden');

    if (finalCoins > 0 && ws && ws.readyState === WebSocket.OPEN) {
      triggerPassportAction('MINIGAME_SCORE', { score: finalCoins });
      ws.send(JSON.stringify({
        type: 'MINIGAME_SCORE',
        payload: { score: finalCoins * 2 }
      }));
    }
  }

  function updateFriendRequestBadge() {
    const count = friendsData.pendingRequests.length;
    friendsBadge.textContent = String(count);
    friendsBadge.classList.toggle('hidden', count === 0);
  }

  function renderFriendsList() {
    updateFriendRequestBadge();

    // Friends list
    if (friendsData.friends.length === 0) {
      friendsListEl.innerHTML = '<li class="empty-state">No friends yet</li>';
    } else {
      friendsListEl.innerHTML = friendsData.friends.map(f => `
        <li class="friend-item" data-friendid="${f.friendId}">
          <span class="friend-name">${escapeHtml(f.name || f.friendId)}</span>
          ${f.statusMessage ? `<span class="friend-message">${escapeHtml(f.statusMessage)}</span>` : ''}
          <span class="friend-status ${f.status}">${f.status}</span>
          <button class="pm-btn" title="Send private message">💬</button>
        </li>
      `).join('');
    }

    // Pending requests
    if (friendsData.pendingRequests.length === 0) {
      pendingListEl.innerHTML = '<li class="empty-state">No pending requests</li>';
    } else {
      pendingListEl.innerHTML = friendsData.pendingRequests.map(r => `
        <li class="request-item" data-requester="${r.requesterId}">
          <span class="request-name">${r.requesterId}</span>
          <button class="accept-btn" title="Accept">✓</button>
          <button class="decline-btn" title="Decline">✕</button>
        </li>
      `).join('');
    }
  }

  function appendPMMessage(sender, text, isSelf) {
    const existingEmpty = pmHistory.querySelector('.empty-state');
    if (existingEmpty) pmHistory.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = `pm-message ${isSelf ? 'sent' : 'received'}`;
    msg.innerHTML = `<span class="pm-sender">${escapeHtml(sender)}</span>: <span class="pm-text">${escapeHtml(text)}</span>`;
    pmHistory.appendChild(msg);
    pmHistory.scrollTop = pmHistory.scrollHeight;
  }

  function sendWs(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // --- Friends Panel Event Handlers ---

  document.getElementById('btn-friends').addEventListener('click', () => {
    friendsModal.classList.remove('hidden');
    sendWs({ type: 'GET_FRIENDS_LIST', payload: null });
    sendWs({ type: 'GET_PRIVATE_MESSAGES', payload: null });
  });

  document.getElementById('btn-close-friends').addEventListener('click', () => {
    friendsModal.classList.add('hidden');
  });

  // Close friends modal when clicking outside
  friendsModal.addEventListener('click', (e) => {
    if (e.target === friendsModal) {
      friendsModal.classList.add('hidden');
    }
  });

  // Add friend form
  document.getElementById('add-friend-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = friendNameInput.value.trim();
    if (!name) return;
    sendWs({ type: 'SEND_FRIEND_REQUEST', payload: { targetName: name } });
  });

  // Pending request accept buttons (event delegation)
  pendingListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.accept-btn');
    if (btn) {
      const li = btn.closest('.request-item');
      const requesterId = li.getAttribute('data-requester');
      sendWs({ type: 'ACCEPT_FRIEND_REQUEST', payload: { requesterId } });
      li.remove();
    }
    const decBtn = e.target.closest('.decline-btn');
    if (decBtn) {
      const li = decBtn.closest('.request-item');
      li.remove();
    }
  });

  // Friend PM buttons (event delegation)
  friendsListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pm-btn');
    if (btn) {
      const li = btn.closest('.friend-item');
      const friendId = li.getAttribute('data-friendid');
      pmTargetInput.value = friendId;
      pmTarget = { id: friendId, name: friendId };
    }
  });

  // Private message form
  document.getElementById('pm-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const targetName = pmTargetInput.value.trim();
    const text = pmTextInput.value.trim();
    if (!targetName || !text) return;
    const targetPlayerId = pmTarget ? pmTarget.id : targetName;
    sendWs({ type: 'SEND_PRIVATE_MESSAGE', payload: { targetPlayerId, text } });
    pmTextInput.value = '';
  });

  // ==========================================================================
  // Player Context Menu Logic
  // ==========================================================================
  function openPlayerContextMenu(player, screenX, screenY) {
    activeContextPlayer = player;
    ctxPlayerName.textContent = player.name || 'Player';
    const ctxStatus = document.getElementById('ctx-player-status');
    if (player.statusMessage) {
      ctxStatus.textContent = `“${player.statusMessage}”`;
      ctxStatus.classList.remove('hidden');
    } else {
      ctxStatus.textContent = '';
      ctxStatus.classList.add('hidden');
    }

    // Position menu near the click coordinates, clamped within window bounds
    const menuWidth = 180;
    const menuHeight = 220;
    const posX = Math.min(screenX + 10, window.innerWidth - menuWidth - 20);
    const posY = Math.min(screenY + 10, window.innerHeight - menuHeight - 20);

    playerContextMenu.style.left = `${Math.max(10, posX)}px`;
    playerContextMenu.style.top = `${Math.max(10, posY)}px`;
    playerContextMenu.classList.remove('hidden');
  }

  document.getElementById('btn-close-ctx-menu').addEventListener('click', () => {
    playerContextMenu.classList.add('hidden');
  });

  document.getElementById('ctx-btn-hug').addEventListener('click', () => {
    if (!activeContextPlayer) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'PLAYER_EMOTE',
        payload: {
          emote: 'hug',
          targetPlayerId: activeContextPlayer.id,
          targetPlayerName: activeContextPlayer.name
        }
      }));
    }
    playerContextMenu.classList.add('hidden');
  });

  document.getElementById('ctx-btn-wave').addEventListener('click', () => {
    if (!activeContextPlayer) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'PLAYER_EMOTE',
        payload: {
          emote: 'wave',
          targetPlayerId: activeContextPlayer.id,
          targetPlayerName: activeContextPlayer.name
        }
      }));
    }
    playerContextMenu.classList.add('hidden');
  });

  document.getElementById('ctx-btn-friend').addEventListener('click', () => {
    if (!activeContextPlayer) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'SEND_FRIEND_REQUEST',
        payload: { targetPlayerName: activeContextPlayer.name }
      }));
      appendChatMessage('system', `Sent friend request to ${activeContextPlayer.name}!`);
    }
    playerContextMenu.classList.add('hidden');
  });

  document.getElementById('ctx-btn-visit').addEventListener('click', () => {
    if (!activeContextPlayer) return;
    // Loft IDs are derived as loft_<suffix> where suffix is id without usr_
    const suffix = activeContextPlayer.id.replace(/^usr_/, '').substring(0, 12);
    const loftRoomId = `loft_${suffix}`;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'SWITCH_ROOM',
        payload: { roomId: loftRoomId }
      }));
    }
    playerContextMenu.classList.add('hidden');
  });

  document.getElementById('ctx-btn-whisper').addEventListener('click', () => {
    if (!activeContextPlayer) return;
    chatInput.value = `/pm ${activeContextPlayer.name} `;
    chatInput.focus();
    playerContextMenu.classList.add('hidden');
  });

  // ==========================================================================
  // Welcome / Auth Gate Modal Logic
  // ==========================================================================
  btnWelcomeGuest.addEventListener('click', () => {
    welcomeOverlay.classList.add('hidden');
    // Ensure stable guest ID in localStorage
    let guestId = localStorage.getItem('haven_guest_id');
    if (!guestId) {
      guestId = 'usr_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('haven_guest_id', guestId);
    }
    initWebSocket(null, guestId);
  });

  btnWelcomeSignin.addEventListener('click', () => {
    welcomeOverlay.classList.add('hidden');
    accountModal.classList.remove('hidden');
    accountFormSignedOut.classList.remove('hidden');
    accountFormLoggedIn.classList.add('hidden');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    loginUsernameInput.focus();
  });

  btnWelcomeSignup.addEventListener('click', () => {
    welcomeOverlay.classList.add('hidden');
    accountModal.classList.remove('hidden');
    accountFormSignedOut.classList.remove('hidden');
    accountFormLoggedIn.classList.add('hidden');
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    signupUsernameInput.focus();
  });

  // ==========================================================================
  // Toast Notifications
  // ==========================================================================
  function showToast(message, icon = '✨') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ==========================================================================
  // Haven Passport System
  // ==========================================================================
  let localPassport = null;

  function loadPassport() {
    localPassport = identityState.passport;
  }

  // Unlocks now come exclusively from accepted server actions.
  function triggerPassportAction() {
    loadPassport();
  }

  function renderPassportUI() {
    if (!localPassport) loadPassport();
    const nameEl = document.getElementById('passport-player-name');
    nameEl.textContent = selfPlayer.name || 'Traveler';
    let residency = document.getElementById('passport-residency');
    if (!residency) {
      residency = document.createElement('p');
      residency.id = 'passport-residency';
      nameEl.after(residency);
    }
    residency.textContent = selfPlayer.isRegistered ? formatResidency(selfPlayer.registeredAt) : 'Guest — register to establish your residency';
    let identityControls = document.getElementById('passport-identity-controls');
    if (!identityControls) {
      identityControls = document.createElement('section');
      identityControls.id = 'passport-identity-controls';
      residency.after(identityControls);
    }
    renderIdentityControls(identityControls, identityState, sendWs);
    const prog = getPassportProgress(localPassport);
    document.getElementById('passport-progress-fill').style.width = `${prog.percent}%`;
    document.getElementById('passport-progress-label').textContent = `${prog.unlockedCount} / ${prog.totalStamps} Stamps Unlocked (${prog.percent}%)`;

    const grid = document.getElementById('passport-stamps-grid');
    grid.innerHTML = '';
    for (const [id, s] of Object.entries(PASSPORT_STAMPS)) {
      const unlocked = !!localPassport.unlockedStamps[id];
      const card = document.createElement('div');
      card.className = `stamp-card ${unlocked ? 'unlocked' : 'locked'}`;
      card.innerHTML = `
        <div class="stamp-icon">${s.icon}</div>
        <div class="stamp-title">${escapeHtml(s.title)}</div>
        <div class="stamp-desc">${escapeHtml(s.description)}</div>
        ${unlocked ? '<div style="font-size:10px; color:#34d399; font-weight:700;">✓ Unlocked</div>' : '<div style="font-size:10px; color:var(--text-muted);">🔒 Locked</div>'}
      `;
      if (unlocked) {
        const pin = document.createElement('button');
        const pinned = identityState.pinnedBadges.includes(id);
        pin.type = 'button'; pin.textContent = pinned ? 'Unpin' : 'Pin badge';
        pin.setAttribute('aria-pressed', String(pinned));
        pin.disabled = !pinned && identityState.pinnedBadges.length >= 3;
        pin.addEventListener('click', () => sendWs({ type: 'UPDATE_IDENTITY', payload: {
          pinnedBadges: pinned ? identityState.pinnedBadges.filter(b => b !== id) : [...identityState.pinnedBadges, id]
        } }));
        card.append(pin);
      }
      grid.appendChild(card);
    }

    // Populate and wire custom status input
    const statusInput = document.getElementById('status-message-input');
    if (statusInput) {
      statusInput.value = identityState?.statusMessage || '';
    }
  }

  const passportModal = document.getElementById('passport-modal');
  const btnPassport = document.getElementById('btn-passport');
  if (btnPassport) {
    btnPassport.addEventListener('click', () => {
      renderPassportUI();
      passportModal.classList.remove('hidden');
    });
  }
  const btnClosePassport = document.getElementById('btn-close-passport');
  if (btnClosePassport) {
    btnClosePassport.addEventListener('click', () => {
      passportModal.classList.add('hidden');
    });
  }

  const btnSaveStatus = document.getElementById('btn-save-status');
  const statusInput = document.getElementById('status-message-input');
  if (btnSaveStatus && statusInput) {
    btnSaveStatus.addEventListener('click', () => {
      const text = statusInput.value.trim();
      sendWs({ type: 'UPDATE_IDENTITY', payload: { statusMessage: text } });
      showToast('💭 Status message updated!', 'info');
    });
    statusInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnSaveStatus.click();
      }
    });
  }

  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  if (btnAudioToggle) {
    const updateAudioBtnText = () => {
      btnAudioToggle.textContent = getMuted() ? '🔇 Sound: Off' : '🔊 Sound: On';
    };
    updateAudioBtnText();
    btnAudioToggle.addEventListener('click', () => {
      initAudio();
      toggleMuted();
      updateAudioBtnText();
      showToast(getMuted() ? '🔇 Sound muted' : '🔊 Sound enabled', 'info');
    });
  }

  // ==========================================================================
  // Navigator Directory
  // ==========================================================================
  const navigatorModal = document.getElementById('navigator-modal');
  const btnNavigator = document.getElementById('btn-navigator');
  const tabNavPublic = document.getElementById('tab-nav-public');
  const tabNavLofts = document.getElementById('tab-nav-lofts');
  const navPublicList = document.getElementById('nav-public-list');
  const navLoftsList = document.getElementById('nav-lofts-list');

  if (btnNavigator) {
    btnNavigator.addEventListener('click', () => {
      navigatorModal.classList.remove('hidden');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'GET_ROOM_DIRECTORY', payload: null }));
      }
    });
  }

  document.getElementById('btn-close-navigator')?.addEventListener('click', () => {
    navigatorModal.classList.add('hidden');
  });

  tabNavPublic?.addEventListener('click', () => {
    tabNavPublic.classList.add('active');
    tabNavLofts.classList.remove('active');
    navPublicList.classList.remove('hidden');
    navLoftsList.classList.add('hidden');
  });

  tabNavLofts?.addEventListener('click', () => {
    tabNavLofts.classList.add('active');
    tabNavPublic.classList.remove('active');
    navLoftsList.classList.remove('hidden');
    navPublicList.classList.add('hidden');
  });

  function renderRoomDirectory(publicRooms, personalLofts) {
    if (!navPublicList || !navLoftsList) return;
    navPublicList.innerHTML = '';
    navLoftsList.innerHTML = '';

    publicRooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-title">${escapeHtml(r.name)}</div>
          <div class="room-card-desc">${escapeHtml(r.description || 'Public Social Sanctuary')}</div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="room-occupancy-badge">👥 ${r.count} online</span>
          <button class="primary-btn" style="padding:6px 14px; font-size:13px;">Enter</button>
        </div>
      `;
      card.querySelector('button').addEventListener('click', () => {
        navigatorModal.classList.add('hidden');
        startRoomTransition(r.name);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'SWITCH_ROOM', payload: { roomId: r.id } }));
        }
      });
      navPublicList.appendChild(card);
    });

    if (personalLofts.length === 0) {
      navLoftsList.innerHTML = '<div class="empty-state" style="padding:20px; text-align:center; color:var(--text-muted);">No other personal lofts currently online</div>';
    } else {
      personalLofts.forEach(r => {
        const card = document.createElement('div');
        card.className = 'room-card';
        card.innerHTML = `
          <div class="room-card-info">
            <div class="room-card-title">🏠 ${escapeHtml(r.name)}</div>
            <div class="room-card-desc">Owner: ${escapeHtml(r.ownerName)}</div>
            ${r.statusMessage ? `<div class="room-card-desc friend-message">“${escapeHtml(r.statusMessage)}”</div>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="room-occupancy-badge">👥 ${r.count} online</span>
            <button class="primary-btn" style="padding:6px 14px; font-size:13px;">Visit</button>
          </div>
        `;
        card.querySelector('button').addEventListener('click', () => {
          navigatorModal.classList.add('hidden');
          startRoomTransition(r.name);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SWITCH_ROOM', payload: { roomId: r.id } }));
          }
        });
        navLoftsList.appendChild(card);
      });
    }
  }

  // ==========================================================================
  // Direct Player Trading
  // ==========================================================================
  const tradeModal = document.getElementById('trade-modal');
  let activeTradeSession = null;
  const myTradeLockBadge = document.getElementById('my-trade-lock-badge');
  const partnerTradeLockBadge = document.getElementById('partner-trade-lock-badge');
  const myTradeCoins = document.getElementById('my-trade-coins');
  const partnerTradeCoins = document.getElementById('partner-trade-coins');
  const btnTradeLock = document.getElementById('btn-trade-lock');
  const btnTradeConfirm = document.getElementById('btn-trade-confirm');
  const btnTradeCancel = document.getElementById('btn-trade-cancel');

  document.getElementById('ctx-btn-trade')?.addEventListener('click', () => {
    if (!activeContextPlayer) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TRADE_REQUEST',
        payload: { targetPlayerId: activeContextPlayer.id }
      }));
      showToast(`Trade request sent to ${activeContextPlayer.name}!`, '🤝');
    }
    playerContextMenu.classList.add('hidden');
  });

  myTradeCoins?.addEventListener('input', () => {
    if (!activeTradeSession) return;
    const coins = Math.max(0, parseInt(myTradeCoins.value, 10) || 0);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TRADE_UPDATE_OFFER',
        payload: { tradeId: activeTradeSession.id, coins, items: [] }
      }));
    }
  });

  btnTradeLock?.addEventListener('click', () => {
    if (!activeTradeSession) return;
    const isP1 = activeTradeSession.player1Id === selfId;
    const myOffer = isP1 ? activeTradeSession.player1Offer : activeTradeSession.player2Offer;
    const newLockState = !myOffer.locked;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TRADE_LOCK',
        payload: { tradeId: activeTradeSession.id, locked: newLockState }
      }));
    }
  });

  btnTradeConfirm?.addEventListener('click', () => {
    if (!activeTradeSession) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TRADE_CONFIRM',
        payload: { tradeId: activeTradeSession.id }
      }));
    }
  });

  btnTradeCancel?.addEventListener('click', () => {
    if (!activeTradeSession) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TRADE_CANCEL',
        payload: { tradeId: activeTradeSession.id }
      }));
    }
    tradeModal.classList.add('hidden');
    activeTradeSession = null;
  });

  document.getElementById('btn-close-trade')?.addEventListener('click', () => {
    if (activeTradeSession && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TRADE_CANCEL',
        payload: { tradeId: activeTradeSession.id }
      }));
    }
    tradeModal.classList.add('hidden');
    activeTradeSession = null;
  });

  function updateTradeUI(session) {
    if (!session) return;
    activeTradeSession = session;
    const isP1 = session.player1Id === selfId;
    const myOffer = isP1 ? session.player1Offer : session.player2Offer;
    const partnerOffer = isP1 ? session.player2Offer : session.player1Offer;

    if (myOffer.locked) {
      myTradeLockBadge.className = 'trade-lock-badge locked';
      myTradeLockBadge.textContent = '🔒 Locked';
      btnTradeLock.textContent = '🔓 Unlock Offer';
      myTradeCoins.disabled = true;
    } else {
      myTradeLockBadge.className = 'trade-lock-badge unlocked';
      myTradeLockBadge.textContent = '🔓 Unlocked';
      btnTradeLock.textContent = '🔒 Lock Offer';
      myTradeCoins.disabled = false;
    }

    if (partnerOffer.locked) {
      partnerTradeLockBadge.className = 'trade-lock-badge locked';
      partnerTradeLockBadge.textContent = '🔒 Locked';
    } else {
      partnerTradeLockBadge.className = 'trade-lock-badge unlocked';
      partnerTradeLockBadge.textContent = '🔓 Unlocked';
    }

    partnerTradeCoins.textContent = partnerOffer.coins.toLocaleString();

    if (myOffer.locked && partnerOffer.locked) {
      btnTradeConfirm.disabled = false;
      if (myOffer.confirmed) {
        btnTradeConfirm.textContent = '✓ Confirmed (Waiting for partner...)';
      } else {
        btnTradeConfirm.textContent = '🤝 Confirm & Swap';
      }
    } else {
      btnTradeConfirm.disabled = true;
      btnTradeConfirm.textContent = '🤝 Both must lock offers';
    }
  }

  // ==========================================================================
  // TRACK 3 & 4 CONTROLLERS: ROTATION, LOFT SETTINGS, DOORBELL, MARKET, CRAFTING, WHITEBOARD
  // ==========================================================================

  // --- UI Helpers ---
  function applyRoomMood(mood = 'day') {
    canvas.className = `mood-${mood}`;
  }

  function updateGemUI(gems) {
    const gemEl = document.getElementById('gem-amount');
    if (gemEl) gemEl.textContent = (gems || 0).toLocaleString();
  }

  function updateMaterialsUI(materials) {
    const mats = materials || { scrap_metal: 0, timber: 0 };
    const scrapEl = document.getElementById('craft-scrap-amount');
    const timberEl = document.getElementById('craft-timber-amount');
    if (scrapEl) scrapEl.textContent = (mats.scrap_metal || 0).toLocaleString();
    if (timberEl) timberEl.textContent = (mats.timber || 0).toLocaleString();
  }

  function updateVipBadge() {
    const crown = document.querySelector('.vip-crown');
    if (selfPlayer.isVip && !crown) {
      const nameEl = document.getElementById('passport-player-name');
      if (nameEl) {
        const span = document.createElement('span');
        span.className = 'vip-crown';
        span.textContent = '👑';
        nameEl.prepend(span);
      }
    }
  }

  // --- 4-Way Rotation Controller ---
  function cycleFurnitureRotation() {
    currentFurniRotation = (currentFurniRotation + 90) % 360;
    const label = document.getElementById('current-rot-label');
    const dirNames = { 0: '0° (South)', 90: '90° (West)', 180: '180° (North)', 270: '270° (East)' };
    if (label) {
      label.textContent = dirNames[currentFurniRotation] || `${currentFurniRotation}°`;
    }
    showToast(`Orientation: ${dirNames[currentFurniRotation] || currentFurniRotation + '°'}`, '🔄');
  }

  document.getElementById('btn-rotate-furni')?.addEventListener('click', cycleFurnitureRotation);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') {
      cycleFurnitureRotation();
    }
  });

  // --- Loft Settings & Expansion Modal ---
  const loftSettingsModal = document.getElementById('loft-settings-modal');
  const btnLoftSettings = document.getElementById('btn-loft-settings');
  const btnCloseLoftSettings = document.getElementById('btn-close-loft-settings');

  btnLoftSettings?.addEventListener('click', () => {
    const sizeEl = document.getElementById('loft-current-size');
    if (sizeEl) sizeEl.textContent = `${getRoomGridWidth()}×${getRoomGridHeight()} Tiles`;
    const moodSelect = document.getElementById('loft-mood-select');
    if (moodSelect && currentRoom.ambientMood) moodSelect.value = currentRoom.ambientMood;
    const currentMode = currentRoom.accessMode || 'public';
    const radio = document.querySelector(`input[name="loft-access"][value="${currentMode}"]`);
    if (radio) radio.checked = true;
    const passContainer = document.getElementById('loft-password-container');
    if (passContainer) passContainer.classList.toggle('hidden', currentMode !== 'password');
    renderLoftDecoratorsList();
    loftSettingsModal?.classList.remove('hidden');
  });

  btnCloseLoftSettings?.addEventListener('click', () => {
    loftSettingsModal?.classList.add('hidden');
  });

  loftSettingsModal?.addEventListener('click', (e) => {
    if (e.target === loftSettingsModal) loftSettingsModal.classList.add('hidden');
  });

  document.querySelectorAll('input[name="loft-access"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const passContainer = document.getElementById('loft-password-container');
      if (passContainer) passContainer.classList.toggle('hidden', e.target.value !== 'password');
    });
  });

  document.getElementById('btn-expand-14')?.addEventListener('click', () => {
    sendWs({ type: 'EXPAND_ROOM', payload: { roomId: currentRoom.id, targetSize: 14 } });
  });

  document.getElementById('btn-expand-18')?.addEventListener('click', () => {
    sendWs({ type: 'EXPAND_ROOM', payload: { roomId: currentRoom.id, targetSize: 18 } });
  });

  document.getElementById('btn-expand-20')?.addEventListener('click', () => {
    sendWs({ type: 'EXPAND_ROOM', payload: { roomId: currentRoom.id, targetSize: 20 } });
  });

  document.getElementById('btn-save-permissions')?.addEventListener('click', () => {
    const mode = document.querySelector('input[name="loft-access"]:checked')?.value || 'public';
    const password = document.getElementById('loft-password-input')?.value || '';
    sendWs({ type: 'SET_ROOM_PERMISSIONS', payload: { roomId: currentRoom.id, accessMode: mode, password } });
    loftSettingsModal?.classList.add('hidden');
  });

  document.getElementById('btn-save-mood')?.addEventListener('click', () => {
    const mood = document.getElementById('loft-mood-select')?.value || 'day';
    sendWs({ type: 'SET_ROOM_MOOD', payload: { roomId: currentRoom.id, mood } });
    applyRoomMood(mood);
    loftSettingsModal?.classList.add('hidden');
  });

  document.getElementById('btn-add-decorator')?.addEventListener('click', () => {
    const input = document.getElementById('loft-decorator-input');
    const decoratorId = input?.value.trim();
    if (decoratorId) {
      sendWs({ type: 'GRANT_DECORATOR', payload: { roomId: currentRoom.id, decoratorId } });
      input.value = '';
    }
  });

  function renderLoftDecoratorsList() {
    const listEl = document.getElementById('loft-decorators-list');
    if (!listEl) return;
    const decorators = currentRoom.decorators || [];
    if (decorators.length === 0) {
      listEl.textContent = 'No co-building decorators assigned yet.';
      return;
    }
    listEl.innerHTML = decorators.map(d => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
        <span>🤝 ${escapeHtml(d)}</span>
        <button class="chip-danger btn-remove-dec" data-id="${escapeHtml(d)}" style="padding:2px 8px; font-size:11px;">Revoke</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.btn-remove-dec').forEach(btn => {
      btn.addEventListener('click', () => {
        const decId = btn.getAttribute('data-id');
        sendWs({ type: 'REVOKE_DECORATOR', payload: { roomId: currentRoom.id, decoratorId: decId } });
      });
    });
  }

  // --- Doorbell Modals & State ---
  let pendingRestrictedRoomId = null;
  let pendingDoorbellVisitorId = null;

  document.getElementById('btn-ring-doorbell')?.addEventListener('click', () => {
    if (pendingRestrictedRoomId) {
      sendWs({ type: 'RING_DOORBELL', payload: { roomId: pendingRestrictedRoomId } });
      showToast('Ringing doorbell... 🔔 Waiting for host.', '🔔');
    }
    document.getElementById('doorbell-visitor-modal')?.classList.add('hidden');
  });

  document.getElementById('btn-cancel-doorbell')?.addEventListener('click', () => {
    document.getElementById('doorbell-visitor-modal')?.classList.add('hidden');
  });

  document.getElementById('btn-doorbell-allow')?.addEventListener('click', () => {
    if (pendingDoorbellVisitorId) {
      sendWs({ type: 'DOORBELL_DECISION', payload: { visitorId: pendingDoorbellVisitorId, allow: true } });
      showToast('Entry allowed! 🚪✨', '✅');
    }
    document.getElementById('doorbell-host-modal')?.classList.add('hidden');
  });

  document.getElementById('btn-doorbell-deny')?.addEventListener('click', () => {
    if (pendingDoorbellVisitorId) {
      sendWs({ type: 'DOORBELL_DECISION', payload: { visitorId: pendingDoorbellVisitorId, allow: false } });
      showToast('Visitor declined. 🚪', '❌');
    }
    document.getElementById('doorbell-host-modal')?.classList.add('hidden');
  });

  // --- Player Marketplace ---
  let activeMarketplaceListings = [];
  const marketplaceModal = document.getElementById('marketplace-modal');
  const btnMarketplace = document.getElementById('btn-marketplace');
  const btnCloseMarketplace = document.getElementById('btn-close-marketplace');
  const tabMarketBrowse = document.getElementById('tab-market-browse');
  const tabMarketSell = document.getElementById('tab-market-sell');
  const marketBrowsePanel = document.getElementById('market-browse-panel');
  const marketSellPanel = document.getElementById('market-sell-panel');
  const marketSearchInput = document.getElementById('market-search-input');

  btnMarketplace?.addEventListener('click', () => {
    marketplaceModal?.classList.remove('hidden');
    sendWs({ type: 'BROWSE_MARKETPLACE', payload: {} });
    populateMarketSellDropdown();
  });

  btnCloseMarketplace?.addEventListener('click', () => {
    marketplaceModal?.classList.add('hidden');
  });

  marketplaceModal?.addEventListener('click', (e) => {
    if (e.target === marketplaceModal) marketplaceModal.classList.add('hidden');
  });

  tabMarketBrowse?.addEventListener('click', () => {
    tabMarketBrowse.classList.add('active');
    tabMarketSell.classList.remove('active');
    marketBrowsePanel?.classList.remove('hidden');
    marketSellPanel?.classList.add('hidden');
  });

  tabMarketSell?.addEventListener('click', () => {
    tabMarketSell.classList.add('active');
    tabMarketBrowse.classList.remove('active');
    marketSellPanel?.classList.remove('hidden');
    marketBrowsePanel?.classList.add('hidden');
    populateMarketSellDropdown();
    renderMyMarketplaceListings();
  });

  marketSearchInput?.addEventListener('input', () => {
    renderMarketplaceListings();
  });

  function populateMarketSellDropdown() {
    const select = document.getElementById('market-sell-select');
    if (!select) return;
    select.innerHTML = Object.values(CATALOG_ITEMS).map(item => `
      <option value="${item.id}">${item.icon} ${escapeHtml(item.name)} (${item.rarity.toUpperCase()})</option>
    `).join('');
  }

  document.getElementById('btn-create-listing')?.addEventListener('click', () => {
    const itemType = document.getElementById('market-sell-select')?.value;
    const price = parseInt(document.getElementById('market-price-input')?.value || '100', 10);
    const currency = document.getElementById('market-currency-select')?.value || 'coins';
    if (!itemType || isNaN(price) || price <= 0) {
      showToast('Please specify a valid item and price.', '⚠️');
      return;
    }
    sendWs({ type: 'LIST_MARKETPLACE_ITEM', payload: { itemType, price, currency } });
  });

  function renderMarketplaceListings() {
    const grid = document.getElementById('market-listings-grid');
    if (!grid) return;
    const query = (marketSearchInput?.value || '').toLowerCase().trim();
    const filtered = activeMarketplaceListings.filter(l => {
      const item = CATALOG_ITEMS[l.itemType];
      const name = item ? item.name.toLowerCase() : l.itemType.toLowerCase();
      return !query || name.includes(query) || (l.sellerName && l.sellerName.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; padding:30px; text-align:center; color:var(--text-muted);">No active listings match your search.</div>';
      return;
    }

    grid.innerHTML = filtered.map(l => {
      const item = CATALOG_ITEMS[l.itemType] || { name: l.itemType, icon: '📦', rarity: 'common' };
      const isMine = l.sellerId === selfId;
      const currencyIcon = l.currency === 'gems' ? '💎' : '🪙';
      return `
        <div class="marketplace-item-card rarity-${item.rarity || 'common'}">
          <div class="item-header">
            <span style="font-size:24px;">${item.icon || '📦'}</span>
            <span class="rarity-badge rarity-${item.rarity || 'common'}">${(item.rarity || 'common').toUpperCase()}</span>
          </div>
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-seller">Seller: ${escapeHtml(l.sellerName || 'Traveler')}</div>
          <div class="item-price">${currencyIcon} ${l.price.toLocaleString()} ${l.currency}</div>
          ${isMine ? `
            <button class="chip-danger btn-cancel-listing" data-id="${l.id}" style="padding:6px; font-size:12px; margin-top:4px;">Cancel & Reclaim</button>
          ` : `
            <button class="primary-btn btn-buy-listing" data-id="${l.id}" style="padding:6px; font-size:12px; margin-top:4px;">Buy Now</button>
          `}
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-buy-listing').forEach(btn => {
      btn.addEventListener('click', () => {
        const listingId = btn.getAttribute('data-id');
        sendWs({ type: 'BUY_MARKETPLACE_ITEM', payload: { listingId } });
      });
    });

    grid.querySelectorAll('.btn-cancel-listing').forEach(btn => {
      btn.addEventListener('click', () => {
        const listingId = btn.getAttribute('data-id');
        sendWs({ type: 'CANCEL_MARKETPLACE_LISTING', payload: { listingId } });
      });
    });
  }

  function renderMyMarketplaceListings() {
    const container = document.getElementById('market-my-listings');
    if (!container) return;
    const myListings = activeMarketplaceListings.filter(l => l.sellerId === selfId);
    if (myListings.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">You have no active escrow listings.</div>';
      return;
    }
    container.innerHTML = myListings.map(l => {
      const item = CATALOG_ITEMS[l.itemType] || { name: l.itemType, icon: '📦' };
      const currencyIcon = l.currency === 'gems' ? '💎' : '🪙';
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.6); padding:8px 12px; border-radius:8px;">
          <span>${item.icon} ${escapeHtml(item.name)} — <strong>${currencyIcon} ${l.price}</strong></span>
          <button class="chip-danger btn-cancel-my-listing" data-id="${l.id}" style="padding:4px 10px; font-size:11px;">Cancel</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-cancel-my-listing').forEach(btn => {
      btn.addEventListener('click', () => {
        const listingId = btn.getAttribute('data-id');
        sendWs({ type: 'CANCEL_MARKETPLACE_LISTING', payload: { listingId } });
      });
    });
  }

  // --- Workshop & Crafting Modal ---
  const craftingModal = document.getElementById('crafting-modal');
  const btnCrafting = document.getElementById('btn-crafting');
  const btnCloseCrafting = document.getElementById('btn-close-crafting');
  const tabCraftRecipes = document.getElementById('tab-craft-recipes');
  const tabCraftRecycle = document.getElementById('tab-craft-recycle');
  const craftBlueprintsPanel = document.getElementById('craft-blueprints-panel');
  const craftRecyclePanel = document.getElementById('craft-recycle-panel');

  btnCrafting?.addEventListener('click', () => {
    craftingModal?.classList.remove('hidden');
    updateMaterialsUI(selfPlayer.materials);
    renderCraftingRecipes();
    populateRecycleDropdown();
  });

  btnCloseCrafting?.addEventListener('click', () => {
    craftingModal?.classList.add('hidden');
  });

  craftingModal?.addEventListener('click', (e) => {
    if (e.target === craftingModal) craftingModal.classList.add('hidden');
  });

  tabCraftRecipes?.addEventListener('click', () => {
    tabCraftRecipes.classList.add('active');
    tabCraftRecycle.classList.remove('active');
    craftBlueprintsPanel?.classList.remove('hidden');
    craftRecyclePanel?.classList.add('hidden');
    renderCraftingRecipes();
  });

  tabCraftRecycle?.addEventListener('click', () => {
    tabCraftRecycle.classList.add('active');
    tabCraftRecipes.classList.remove('active');
    craftRecyclePanel?.classList.remove('hidden');
    craftBlueprintsPanel?.classList.add('hidden');
    populateRecycleDropdown();
  });

  function renderCraftingRecipes() {
    const list = document.getElementById('workshop-recipes-list');
    if (!list) return;
    const mats = selfPlayer.materials || { scrap_metal: 0, timber: 0 };
    list.innerHTML = Object.values(WORKSHOP_RECIPES).map(r => {
      const canCraft = canCraftRecipe(r.id, mats);
      return `
        <div class="recipe-card rarity-${r.rarity || 'common'}">
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:26px;">${r.icon}</span>
            <div class="recipe-info">
              <div class="recipe-name">${escapeHtml(r.name)}</div>
              <div class="recipe-cost">
                <span>🔩 Scrap: <span class="cost-val" style="color:${(mats.scrap_metal || 0) >= r.materials.scrap_metal ? '#34d399' : '#ef4444'}">${r.materials.scrap_metal}</span></span>
                <span>🪵 Timber: <span class="cost-val" style="color:${(mats.timber || 0) >= r.materials.timber ? '#34d399' : '#ef4444'}">${r.materials.timber}</span></span>
              </div>
            </div>
          </div>
          <button class="primary-btn btn-craft-action" data-id="${r.id}" ${canCraft ? '' : 'disabled'} style="padding:8px 16px; font-size:12px;">
            ${canCraft ? '🔨 Assemble' : '🔒 Missing Parts'}
          </button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.btn-craft-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const recipeId = btn.getAttribute('data-id');
        sendWs({ type: 'CRAFT_ITEM', payload: { recipeId } });
      });
    });
  }

  function populateRecycleDropdown() {
    const select = document.getElementById('recycle-item-select');
    if (!select) return;
    select.innerHTML = Object.values(CATALOG_ITEMS).map(item => `
      <option value="${item.id}">${item.icon} ${escapeHtml(item.name)}</option>
    `).join('');
    updateRecycleYieldPreview();
  }

  function updateRecycleYieldPreview() {
    const select = document.getElementById('recycle-item-select');
    const preview = document.getElementById('recycle-yield-preview');
    if (!select || !preview) return;
    const y = calculateSalvageYield(select.value);
    preview.textContent = `Estimated Salvage: +${y.scrap_metal} Scrap Metal 🔩, +${y.timber} Timber 🪵`;
  }

  document.getElementById('recycle-item-select')?.addEventListener('change', updateRecycleYieldPreview);

  document.getElementById('btn-recycle-action')?.addEventListener('click', () => {
    const select = document.getElementById('recycle-item-select');
    const itemType = select?.value;
    if (itemType) {
      sendWs({ type: 'RECYCLE_ITEM', payload: { itemType } });
    }
  });

  // --- Collaborative Whiteboard ---
  const whiteboardModal = document.getElementById('whiteboard-modal');
  const btnCloseWhiteboard = document.getElementById('btn-close-whiteboard');
  const wbCanvas = document.getElementById('whiteboard-canvas');
  const wbCtx = wbCanvas?.getContext('2d');
  let wbActiveColor = '#ffffff';
  let wbActiveSize = 3;
  let isWbDrawing = false;
  let currentStrokePoints = [];

  function openWhiteboardModal() {
    whiteboardModal?.classList.remove('hidden');
  }

  btnCloseWhiteboard?.addEventListener('click', () => {
    whiteboardModal?.classList.add('hidden');
  });

  whiteboardModal?.addEventListener('click', (e) => {
    if (e.target === whiteboardModal) whiteboardModal.classList.add('hidden');
  });

  document.querySelectorAll('.wb-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-color-btn').forEach(b => b.style.border = 'none');
      btn.style.border = '2px solid #a855f7';
      wbActiveColor = btn.getAttribute('data-color') || '#ffffff';
      wbActiveSize = wbActiveColor === '#0f172a' ? 14 : 3;
    });
  });

  document.getElementById('whiteboard-clear-btn')?.addEventListener('click', () => {
    sendWs({ type: 'WHITEBOARD_CLEAR', payload: { roomId: currentRoom.id } });
    if (wbCtx && wbCanvas) {
      wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    }
  });

  function drawWhiteboardStroke(stroke) {
    if (!wbCtx || !stroke || !stroke.points || stroke.points.length < 2) return;
    wbCtx.strokeStyle = stroke.color;
    wbCtx.lineWidth = stroke.size || 3;
    wbCtx.lineCap = 'round';
    wbCtx.lineJoin = 'round';
    wbCtx.beginPath();
    wbCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      wbCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    wbCtx.stroke();
  }

  if (wbCanvas && wbCtx) {
    function getWbPos(e) {
      const rect = wbCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (wbCanvas.width / rect.width),
        y: (clientY - rect.top) * (wbCanvas.height / rect.height)
      };
    }

    const startDraw = (e) => {
      isWbDrawing = true;
      const pt = getWbPos(e);
      currentStrokePoints = [pt];
      wbCtx.strokeStyle = wbActiveColor;
      wbCtx.lineWidth = wbActiveSize;
      wbCtx.lineCap = 'round';
      wbCtx.beginPath();
      wbCtx.moveTo(pt.x, pt.y);
    };

    const moveDraw = (e) => {
      if (!isWbDrawing) return;
      const pt = getWbPos(e);
      currentStrokePoints.push(pt);
      wbCtx.lineTo(pt.x, pt.y);
      wbCtx.stroke();
    };

    const endDraw = () => {
      if (!isWbDrawing) return;
      isWbDrawing = false;
      if (currentStrokePoints.length > 1) {
        sendWs({
          type: 'WHITEBOARD_STROKE',
          payload: {
            roomId: currentRoom.id,
            stroke: {
              color: wbActiveColor,
              size: wbActiveSize,
              points: currentStrokePoints
            }
          }
        });
      }
      currentStrokePoints = [];
    };

    wbCanvas.addEventListener('mousedown', startDraw);
    wbCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);

    wbCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
    wbCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); moveDraw(e); }, { passive: false });
    window.addEventListener('touchend', endDraw);
  }

  // Auto-connect immediately: use saved account or persistent guest session
  const storedToken = localStorage.getItem('haven_token');
  let storedGuestId = localStorage.getItem('haven_guest_id');

  if (!storedToken && !storedGuestId) {
    storedGuestId = 'usr_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('haven_guest_id', storedGuestId);
  }

  // Ensure welcome overlay stays hidden so pointer events are never blocked
  welcomeOverlay.classList.add('hidden');

  if (storedToken) {
    authPlayerId = storedToken;
    selfId = storedToken;
    initWebSocket(storedToken, null);
  } else {
    selfId = storedGuestId;
    initWebSocket(null, storedGuestId);
  }

  window.__havenGame = {
    getCurrentRoom: () => currentRoom,
    getSelfPlayer: () => selfPlayer,
    get selfPlayer() { return selfPlayer; },
  };

  if ('serviceWorker' in navigator && typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  requestAnimationFrame(gameLoop);
