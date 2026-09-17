// HavenWorld — Game Engine & Multiplayer Client (HTML5 Canvas + WebSockets)
// ES module: pure logic is imported from shared/ (unit-tested in Node).
import { toScreen as isoToScreen, toGrid as isoToGrid } from './shared/iso.js';
import { calculateFacing, getWalkBob, stepToward, frameDt, fadeAlpha } from './shared/movement.js';
import { RECIPES, pickRecipe, matchRecipe, scoreCoins } from './shared/pizza.js';
import { escapeHtml } from './shared/chat.js';
import { initAudio, playFootstep, playFurniPop, playCoinChime, playChatPing, playDoorwayWhoosh, playSitSound, playSwitchClick, toggleMuted, getMuted } from './shared/audio.js';
import { PASSPORT_STAMPS, createDefaultPassport, recordPassportAction, getPassportProgress } from './shared/passport.js';

  // State
  let ws = null;
  let selfId = null;
  let authToken = null; // WS auth token (persisted account player ID, if logged in)
  let authPlayerId = null; // Persisted account player ID (if logged in)
  let selfPlayer = {
    id: null,
    name: 'Traveler',
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
    lastChat: null
  };
  const otherPlayers = new Map();
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

  // Isometric Constants
  const TILE_WIDTH = 64;
  const TILE_HEIGHT = 32;
  const GRID_SIZE = 12;

    // Bind canvas-derived origin to the shared pure isometric converters.
  function origin() { return { x: canvas.width / 2, y: Math.max(120, canvas.height * 0.22) }; }
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
        selfPlayer = { ...selfPlayer, ...msg.payload.player, id: selfId };
        currentRoom = msg.payload.room;
        otherPlayers.clear();
        msg.payload.otherPlayers.forEach(p => otherPlayers.set(p.id, p));
        updateCoinUI(selfPlayer.coins);

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
          p.x = startX;
          p.y = startY;
          p.targetX = targetX;
          p.targetY = targetY;
          if (typeof isSitting === 'boolean') p.isSitting = isSitting;
          if (facing) p.facing = facing;
        }
        break;
      }

      case 'PLAYER_PROFILE_UPDATED': {
        const { playerId, player } = msg.payload;
        if (playerId === selfId) {
          selfPlayer.name = player.name;
          selfPlayer.avatar = player.avatar;
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
        selfPlayer = { ...selfPlayer, ...msg.payload.player };
        otherPlayers.clear();
        msg.payload.otherPlayers.forEach(p => otherPlayers.set(p.id, p));
        appendChatMessage('system', `Entered: ${currentRoom.name}`);
        playDoorwayWhoosh();
        triggerPassportAction('ENTER_ROOM', { roomId: currentRoom.id });

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

      case 'PLAYER_EMOTED': {
        const { fromPlayerId, emote, targetPlayerId } = msg.payload;
        // Spawn floating hearts if hug or heart
        if (emote === 'hug' || emote === 'heart') {
          const fromP = fromPlayerId === selfPlayer.id ? selfPlayer : otherPlayers.get(fromPlayerId);
          if (fromP) spawnEmoteHearts(fromP.x, fromP.y);
          if (targetPlayerId) {
            const toP = targetPlayerId === selfPlayer.id ? selfPlayer : otherPlayers.get(targetPlayerId);
            if (toP) spawnEmoteHearts(toP.x, toP.y);
          }
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
    // Move self
    updatePlayerMovement(selfPlayer, dt);

    // Move others
    for (const [_, p] of otherPlayers) {
      updatePlayerMovement(p, dt);
    }

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
    const entities = [];

    // Furniture
    currentRoom.furniture.forEach(f => {
      // Sort by (x + y) + elevation so elevated furniture renders above floor-level
      // but still respects depth ordering within the same elevation tier
      entities.push({
        type: 'furniture',
        item: f,
        sortY: f.x + f.y + ((f.elevation || 0) * 2)
      });
    });

    // Players
    entities.push({
      type: 'player',
      player: selfPlayer,
      isSelf: true,
      sortY: selfPlayer.x + selfPlayer.y
    });

    for (const [_, p] of otherPlayers) {
      entities.push({
        type: 'player',
        player: p,
        isSelf: false,
        sortY: p.x + p.y
      });
    }

    // Depth sort: lower (x + y) renders behind higher (x + y)
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
  const WALL_HEIGHT = 80;

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
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        const pt = toScreen(x, y);

        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x + TILE_WIDTH / 2, pt.y + TILE_HEIGHT / 2);
        ctx.lineTo(pt.x, pt.y + TILE_HEIGHT);
        ctx.lineTo(pt.x - TILE_WIDTH / 2, pt.y + TILE_HEIGHT / 2);
        ctx.closePath();

        // Check if this tile is the interactive doorway
        const isDoorTile = (x === Math.floor(GRID_SIZE / 2) && y === 0);

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

    for (let x = 0; x < GRID_SIZE; x++) {
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
      ctx.lineTo(p1.x, p1.y - 8);
      ctx.lineTo(p0.x, p0.y - 8);
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

    for (let y = 0; y < GRID_SIZE; y++) {
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
      ctx.lineTo(p1.x, p1.y - 8);
      ctx.lineTo(p0.x, p0.y - 8);
      ctx.closePath();
      ctx.fillStyle = baseboardColor;
      ctx.fill();
    }
  }

  function drawInteractiveDoorway() {
    const doorX = Math.floor(GRID_SIZE / 2);
    const p0 = toScreen(doorX, 0);
    const p1 = toScreen(doorX + 1, 0);
    const doorHeight = 62;

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
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Doorway sign badge
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2 - doorHeight - 12;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(midX - 35, midY - 9, 70, 18, 9);
    ctx.fill();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = 'bold 9px Quicksand, sans-serif';
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
    ctx.ellipse(pt.x, pt.y + TILE_HEIGHT / 2, 16, 8, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(168, 85, 247, ${t.alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawAmbientLighting() {
    const lights = currentRoom.furniture.filter(f => {
      const isLight = f.type === 'neon' || f.type === 'tv' || f.type === 'lamp';
      return isLight && (f.state?.isOn ?? true);
    });

    if (lights.length === 0) return;

    ctx.save();
    for (const f of lights) {
      const pt = toScreen(f.x, f.y);
      const cx = pt.x;
      const cy = pt.y + TILE_HEIGHT / 2 - (f.elevation || 0) * 20 - 15;
      const radius = f.type === 'neon' ? 110 : f.type === 'tv' ? 95 : 100;
      const grad = ctx.createRadialGradient(cx, cy, 6, cx, cy, radius);
      if (f.type === 'neon') {
        grad.addColorStop(0, 'rgba(236, 72, 153, 0.24)');
      } else if (f.type === 'tv') {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
      } else {
        grad.addColorStop(0, 'rgba(253, 224, 71, 0.26)');
      }
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFurniture(f) {
    const pt = toScreen(f.x, f.y);
    const cx = pt.x;
    // Elevation offsets the furniture upward (z-ordering for multi-layer)
    const elevationOffset = (f.elevation || 0) * 20;
    const cy = pt.y + TILE_HEIGHT / 2 - elevationOffset;

    ctx.save();
    switch (f.type) {
      case 'sofa': {
        // Modern Cozy Velvet Sofa
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 8, 30, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4f46e5';
        ctx.fillRect(cx - 28, cy - 28, 56, 18); // Backrest
        ctx.fillStyle = '#818cf8';
        ctx.fillRect(cx - 24, cy - 12, 48, 8); // Cushions
        break;
      }
      case 'table': {
        // Oak Coffee Table
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 16, 22, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy - 14); ctx.lineTo(cx - 14, cy);
        ctx.moveTo(cx + 14, cy - 14); ctx.lineTo(cx + 14, cy);
        ctx.stroke();
        break;
      }
      case 'plant': {
        // Monstera Houseplant
        ctx.fillStyle = '#92400e';
        ctx.fillRect(cx - 8, cy - 10, 16, 12); // Terracotta pot
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.ellipse(cx - 10, cy - 26, 12, 18, -0.4, 0, Math.PI * 2);
        ctx.ellipse(cx + 10, cy - 26, 12, 18, 0.4, 0, Math.PI * 2);
        ctx.ellipse(cx, cy - 32, 14, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'tv': {
        // Retro CRT TV
        const isOn = f.state?.isOn ?? true;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(cx - 16, cy - 32, 32, 26);
        ctx.fillStyle = isOn ? '#38bdf8' : '#0f172a';
        ctx.fillRect(cx - 12, cy - 28, 20, 18); // Screen
        if (isOn) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fillRect(cx - 10, cy - 26, 16, 2); // Glare
        }
        break;
      }
      case 'neon': {
        // Neon Wall Sign
        const isOn = f.state?.isOn ?? true;
        if (isOn) {
          ctx.shadowColor = '#ec4899';
          ctx.shadowBlur = 14;
          ctx.fillStyle = '#f472b6';
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#475569';
        }
        ctx.font = 'bold 12px Quicksand';
        ctx.fillText('✨ HAVEN', cx - 26, cy - 24);
        break;
      }
      case 'lamp': {
        // Modern Table/Floor Lamp
        const isOn = f.state?.isOn ?? true;
        ctx.fillStyle = '#64748b';
        ctx.fillRect(cx - 2, cy - 26, 4, 26); // Stand
        ctx.beginPath();
        ctx.ellipse(cx, cy - 2, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill(); // Base
        // Lampshade
        ctx.fillStyle = isOn ? '#fef08a' : '#94a3b8';
        if (isOn) {
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 14;
        }
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy - 18);
        ctx.lineTo(cx + 10, cy - 18);
        ctx.lineTo(cx + 14, cy - 34);
        ctx.lineTo(cx - 14, cy - 34);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'arcade': {
        // Arcade Cabinet
        ctx.fillStyle = '#a855f7';
        ctx.fillRect(cx - 14, cy - 42, 28, 40);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(cx - 10, cy - 36, 20, 14); // Screen
        break;
      }
      case 'fountain': {
        // Plaza Water Fountain
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 6, 36, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 10, 26, 13, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bench': {
        ctx.fillStyle = '#475569';
        ctx.fillRect(cx - 20, cy - 16, 40, 10);
        break;
      }
    }
    ctx.restore();
  }

  function drawAvatar(p, isSelf) {
    const pt = toScreen(p.x, p.y);
    const cx = pt.x;
    const cy = pt.y + TILE_HEIGHT / 2;

    const av = p.avatar || selfPlayer.avatar;
    const isSitting = !!p.isSitting;
    const facing = p.facing || 'SE';
    const bounce = (!isSitting && p.isWalking) ? getWalkBob(p.walkCycle || 0, 3) : 0;

    ctx.save();

    // Floor Shadow
    ctx.beginPath();
    ctx.ellipse(cx, cy, isSitting ? 16 : 14, isSitting ? 8 : 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();

    // Base Y: Lower by 7px when seated
    const baseY = cy - (isSitting ? 2 : 8) + bounce;

    if (isSitting) {
      // Seated Legs: Folded forward horizontally
      ctx.fillStyle = av.pantsColor || '#34495e';
      ctx.beginPath();
      ctx.roundRect(cx - 9, baseY - 6, 18, 6, 3);
      ctx.fill();

      // Torso / Shirt (slightly more compact)
      ctx.fillStyle = av.shirtColor || '#2e86c1';
      ctx.beginPath();
      ctx.roundRect(cx - 9, baseY - 22, 18, 16, 5);
      ctx.fill();
    } else {
      // Standing Legs / Pants
      ctx.fillStyle = av.pantsColor || '#34495e';
      ctx.fillRect(cx - 7, baseY - 12, 5, 14);
      ctx.fillRect(cx + 2, baseY - 12, 5, 14);

      // Torso / Shirt
      ctx.fillStyle = av.shirtColor || '#2e86c1';
      ctx.beginPath();
      ctx.roundRect(cx - 10, baseY - 28, 20, 18, 6);
      ctx.fill();
    }

    const headY = isSitting ? baseY - 28 : baseY - 36;

    // Head Base (Skin)
    ctx.fillStyle = av.skin || '#f5cba7';
    ctx.beginPath();
    ctx.arc(cx, headY, 11, 0, Math.PI * 2);
    ctx.fill();

    // Facial features or Back Hair depending on 4-way facing:
    // 'NW' or 'NE' are looking AWAY from the isometric camera (back of avatar)
    // 'SE' or 'SW' are looking TOWARD the camera (front of avatar)
    const isFacingBack = (facing === 'NW' || facing === 'NE');

    if (isFacingBack) {
      // Back of head — full hair coverage
      ctx.fillStyle = av.hairColor || '#4a235a';
      ctx.beginPath();
      ctx.arc(cx, headY - 1, 11.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Front-facing ('SE' = down-right, 'SW' = down-left)
      const eyeShift = facing === 'SW' ? -2 : 2;

      // Eyes
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(cx - 4 + eyeShift, headY, 1.6, 0, Math.PI * 2);
      ctx.arc(cx + 4 + eyeShift, headY, 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Smile
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx + eyeShift / 2, headY + 2, 4, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // Front Hair style / bangs
      ctx.fillStyle = av.hairColor || '#4a235a';
      ctx.beginPath();
      ctx.arc(cx, headY - 5, 12, Math.PI * 0.8, Math.PI * 2.2);
      ctx.fill();
    }

    // Name Tag
    ctx.font = 'bold 11px Quicksand, sans-serif';
    const tagText = p.name || 'Traveler';
    const textWidth = ctx.measureText(tagText).width;

    ctx.fillStyle = isSelf ? 'rgba(139, 92, 246, 0.85)' : 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(cx - textWidth / 2 - 6, (isSitting ? baseY - 54 : baseY - 62), textWidth + 12, 16, 8);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(tagText, cx - textWidth / 2, (isSitting ? baseY - 42 : baseY - 50));

    ctx.restore();
  }

  function drawSpeechBubble(p) {
    if (!p.lastChat) return;
    const age = (Date.now() - p.lastChat.timestamp) / 1000;
    if (age > 6) {
      p.lastChat = null;
      return;
    }

    const alpha = fadeAlpha(age, 6, 5);
    const pt = toScreen(p.x, p.y);
    const cx = pt.x;
    const cy = pt.y + TILE_HEIGHT / 2 - 76;

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
      const cy = pt.y + TILE_HEIGHT / 2 - 20; // center of avatar torso/head
      const dx = sx - cx;
      const dy = sy - cy;
      if (Math.hypot(dx, dy) < 28) {
        // Hit detected on other player!
        openPlayerContextMenu(p, e.clientX, e.clientY);
        return;
      }
    }

    // 2. Check if clicking on the Interactive Doorway (at doorX = Math.floor(GRID_SIZE / 2), y = 0)
    const doorX = Math.floor(GRID_SIZE / 2);
    const doorPt0 = toScreen(doorX, 0);
    const doorPt1 = toScreen(doorX + 1, 0);
    const doorMidX = (doorPt0.x + doorPt1.x) / 2;
    const doorMidY = (doorPt0.y + doorPt1.y) / 2 - 30; // middle of doorway frame
    if (Math.hypot(sx - doorMidX, sy - doorMidY) < 36) {
      // Toggle room: if in plaza, switch to personal loft; if in loft, switch to plaza
      const isLoft = currentRoom.id.startsWith('loft_');
      let targetRoomId = 'plaza';
      if (!isLoft) {
        // Find player's loft ID from room-select options or user's derived loft ID
        const loftOption = Array.from(document.getElementById('room-select').options)
          .find(opt => opt.value.startsWith('loft_'));
        if (loftOption) {
          targetRoomId = loftOption.value;
        }
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'SWITCH_ROOM',
          payload: { roomId: targetRoomId }
        }));
      }
      return;
    }

    const grid = toGrid(sx, sy);
    if (grid.x < -0.5 || grid.x > GRID_SIZE + 0.5 || grid.y < -0.5 || grid.y > GRID_SIZE + 0.5) return;

    // Gentle clamp within the playable grid
    const targetX = Math.max(0.5, Math.min(GRID_SIZE - 0.5, grid.x));
    const targetY = Math.max(0.5, Math.min(GRID_SIZE - 0.5, grid.y));

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
        return Math.hypot(dx, dy) < 30; // Approx click radius
      });

      if (clickedFurniture && !parentSurfaceId) {
        // Select this furniture as a parent surface
        parentSurfaceId = clickedFurniture.id;
        targetIndicator = { x: targetX, y: targetY, alpha: 1.0, parentSurface: clickedFurniture.id };
        return; // Don't place yet — now in "place on surface" mode
      }

      // Place furniture
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'PLACE_FURNITURE',
          payload: {
            type: selectedFurnitureType,
            x: targetX,
            y: targetY,
            elevation: parentSurfaceId ? 1 : 0,
            parentSurfaceId: parentSurfaceId || null
          }
        }));
      }
      // Clear parent surface selection after placing
      if (parentSurfaceId) parentSurfaceId = null;
    } else {
      // Check interactive furniture hit test (seating & toggles)
      const clickedFurniture = currentRoom.furniture.slice().reverse().find(f => {
        const pt = toScreen(f.x, f.y);
        const cx = pt.x;
        const cy = pt.y + TILE_HEIGHT / 2 - (f.elevation || 0) * 20;
        const dx = sx - cx;
        const dy = sy - cy;
        return Math.hypot(dx, dy) < 26;
      });

      if (clickedFurniture) {
        const seatTypes = ['sofa', 'bench', 'chair', 'stool', 'bed'];
        const lightTypes = ['lamp', 'neon', 'tv', 'plant'];
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
          type: 'MOVE',
          payload: { x: targetX, y: targetY }
        }));
      }
    }
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
      const text = btn.getAttribute('data-text');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CHAT', payload: { text } }));
      }
    });
  });

  function appendChatMessage(sender, text) {
    const box = document.getElementById('chat-history');
    const msg = document.createElement('div');
    msg.className = 'chat-msg';

    if (sender === 'system') {
      msg.classList.add('system');
      msg.innerHTML = `<span class="time">[System]</span> <span class="text">${escapeHtml(text)}</span>`;
    } else {
      msg.innerHTML = `<span class="sender">${escapeHtml(sender)}:</span> <span class="text">${escapeHtml(text)}</span>`;
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

    // Head
    pctx.fillStyle = av.skin;
    pctx.beginPath();
    pctx.arc(cx, cy - 40, 20, 0, Math.PI * 2);
    pctx.fill();

    // Eyes
    pctx.fillStyle = '#1e293b';
    pctx.beginPath();
    pctx.arc(cx - 7, cy - 40, 2.5, 0, Math.PI * 2);
    pctx.arc(cx + 7, cy - 40, 2.5, 0, Math.PI * 2);
    pctx.fill();

    // Smile
    pctx.strokeStyle = '#1e293b';
    pctx.lineWidth = 2;
    pctx.beginPath();
    pctx.arc(cx, cy - 36, 7, 0.2, Math.PI - 0.2);
    pctx.stroke();

    // Hair
    pctx.fillStyle = av.hairColor;
    pctx.beginPath();
    pctx.arc(cx, cy - 46, 22, Math.PI * 0.8, Math.PI * 2.2);
    pctx.fill();

    // Torso
    pctx.fillStyle = av.shirtColor;
    pctx.beginPath();
    pctx.roundRect(cx - 18, cy - 18, 36, 32, 8);
    pctx.fill();

    // Legs
    pctx.fillStyle = av.pantsColor;
    pctx.fillRect(cx - 14, cy + 14, 10, 24);
    pctx.fillRect(cx + 4, cy + 14, 10, 24);
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
          <span class="friend-name">${f.friendId}</span>
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
    try {
      const saved = localStorage.getItem('haven_passport');
      if (saved) {
        localPassport = JSON.parse(saved);
      }
    } catch {}
    if (!localPassport) {
      localPassport = createDefaultPassport(selfId || 'guest', selfPlayer.name || 'Traveler');
    }
  }

  function triggerPassportAction(actionType, metadata = {}) {
    if (!localPassport) loadPassport();
    localPassport.playerName = selfPlayer.name || 'Traveler';
    const newStamps = recordPassportAction(localPassport, actionType, metadata);
    try {
      localStorage.setItem('haven_passport', JSON.stringify(localPassport));
    } catch {}
    for (const s of newStamps) {
      showToast(`Achievement Unlocked: ${s.icon} ${s.title}!`, s.icon);
      playCoinChime();
    }
  }

  function renderPassportUI() {
    if (!localPassport) loadPassport();
    document.getElementById('passport-player-name').textContent = selfPlayer.name || 'Traveler';
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
      grid.appendChild(card);
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
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="room-occupancy-badge">👥 ${r.count} online</span>
            <button class="primary-btn" style="padding:6px 14px; font-size:13px;">Visit</button>
          </div>
        `;
        card.querySelector('button').addEventListener('click', () => {
          navigatorModal.classList.add('hidden');
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

  // --- Start Client ---
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
  };

  requestAnimationFrame(gameLoop);
