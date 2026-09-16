// HavenWorld — Game Engine & Multiplayer Client (HTML5 Canvas + WebSockets)
// ES module: pure logic is imported from shared/ (unit-tested in Node).
import { toScreen as isoToScreen, toGrid as isoToGrid } from './shared/iso.js';
import { stepToward, frameDt, fadeAlpha } from './shared/movement.js';
import { RECIPES, pickRecipe, matchRecipe, scoreCoins } from './shared/pizza.js';
import { escapeHtml } from './shared/chat.js';

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

  // ==========================================================================
  // WebSocket Multiplayer Networking
  // ==========================================================================
  function initWebSocket(token = null) {
    authToken = token;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}`;
    if (token) {
      wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
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
      setTimeout(() => initWebSocket(authToken), 3000);
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'INIT_STATE': {
        selfId = msg.payload.selfId;
        selfPlayer = { ...selfPlayer, ...msg.payload.player };
        currentRoom = msg.payload.room;
        otherPlayers.clear();
        msg.payload.otherPlayers.forEach(p => otherPlayers.set(p.id, p));
        updateCoinUI(selfPlayer.coins);
        document.getElementById('room-select').value = currentRoom.id;

        // If the server sent us a personal loft room ID, add it to the dropdown
        if (msg.payload.playerLoftRoomId) {
          addLoftToRoomSelector(msg.payload.playerLoftRoomId, msg.payload.playerLoftName);
          // Default room-select to the loft if we were in it
          const roomSelect = document.getElementById('room-select');
          if (currentRoom.id.startsWith('loft_')) {
            roomSelect.value = currentRoom.id;
          }
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
        const { playerId, startX, startY, targetX, targetY } = msg.payload;
        if (playerId === selfId) {
          selfPlayer.targetX = targetX;
          selfPlayer.targetY = targetY;
        } else if (otherPlayers.has(playerId)) {
          const p = otherPlayers.get(playerId);
          p.x = startX;
          p.y = startY;
          p.targetX = targetX;
          p.targetY = targetY;
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
        break;
      }

      case 'ROOM_CHANGED': {
        currentRoom = msg.payload.room;
        selfPlayer = { ...selfPlayer, ...msg.payload.player };
        otherPlayers.clear();
        msg.payload.otherPlayers.forEach(p => otherPlayers.set(p.id, p));
        appendChatMessage('system', `Entered: ${currentRoom.name}`);

        // Update room selector
        const roomSelect = document.getElementById('room-select');
        roomSelect.value = currentRoom.id;
        if (currentRoom.id.startsWith('loft_')) {
          addLoftToRoomSelector(currentRoom.id, currentRoom.name);
        }
        break;
      }

      case 'FURNITURE_ADDED': {
        currentRoom.furniture.push(msg.payload.item);
        break;
      }

      case 'FURNITURE_REMOVED': {
        const id = msg.payload.id;
        currentRoom.furniture = currentRoom.furniture.filter(f => f.id !== id);
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
    // Select it
    roomSelect.value = roomId;
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
  }

  function updatePlayerMovement(p, dt) {
    stepToward(p, dt, 3.8);
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Isometric Floor & Grid
    drawIsometricFloor();

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
  }

  // ==========================================================================
  // Isometric Drawing Helpers
  // ==========================================================================
  function drawIsometricFloor() {
    const isPlaza = currentRoom.id === 'plaza' || !currentRoom.id.startsWith('loft_');
    const isLoft = currentRoom.id.startsWith('loft_');

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        const pt = toScreen(x, y);

        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(pt.x + TILE_WIDTH / 2, pt.y + TILE_HEIGHT / 2);
        ctx.lineTo(pt.x, pt.y + TILE_HEIGHT);
        ctx.lineTo(pt.x - TILE_WIDTH / 2, pt.y + TILE_HEIGHT / 2);
        ctx.closePath();

        // Floor styling
        if (isPlaza) {
          // Marble checkerboard
          ctx.fillStyle = (x + y) % 2 === 0 ? '#1e293b' : '#334155';
        } else if (isLoft) {
          // Warm hardwood parquet (personal loft)
          ctx.fillStyle = (x + y) % 2 === 0 ? '#78350f' : '#92400e';
        } else {
          // Default to plaza style
          ctx.fillStyle = (x + y) % 2 === 0 ? '#1e293b' : '#334155';
        }
        ctx.fill();

        // Grid lines (highlighted in edit mode)
        ctx.strokeStyle = editMode && isLoft ? 'rgba(168, 85, 247, 0.4)' : 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
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
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(cx - 16, cy - 32, 32, 26);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(cx - 12, cy - 28, 20, 18); // Glowing screen
        break;
      }
      case 'neon': {
        // Neon Wall Sign
        ctx.shadowColor = '#ec4899';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#f472b6';
        ctx.font = 'bold 12px Quicksand';
        ctx.fillText('✨ HAVEN', cx - 26, cy - 24);
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
    const bounce = p.isWalking ? Math.sin(p.walkCycle || 0) * 3 : 0;

    ctx.save();

    // Floor Shadow
    ctx.beginPath();
    ctx.ellipse(cx, cy, 14, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();

    const baseY = cy - 8 + bounce;

    // Legs / Pants
    ctx.fillStyle = av.pantsColor || '#34495e';
    ctx.fillRect(cx - 7, baseY - 12, 5, 14);
    ctx.fillRect(cx + 2, baseY - 12, 5, 14);

    // Torso / Shirt
    ctx.fillStyle = av.shirtColor || '#2e86c1';
    ctx.beginPath();
    ctx.roundRect(cx - 10, baseY - 28, 20, 18, 6);
    ctx.fill();

    // Head / Face
    ctx.fillStyle = av.skin || '#f5cba7';
    ctx.beginPath();
    ctx.arc(cx, baseY - 36, 11, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(cx - 4, baseY - 36, 1.6, 0, Math.PI * 2);
    ctx.arc(cx + 4, baseY - 36, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, baseY - 34, 4, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Hair
    ctx.fillStyle = av.hairColor || '#4a235a';
    ctx.beginPath();
    ctx.arc(cx, baseY - 41, 12, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();

    // Name Tag
    ctx.font = 'bold 11px Quicksand, sans-serif';
    const tagText = p.name || 'Traveler';
    const textWidth = ctx.measureText(tagText).width;

    ctx.fillStyle = isSelf ? 'rgba(139, 92, 246, 0.85)' : 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(cx - textWidth / 2 - 6, baseY - 62, textWidth + 12, 16, 8);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(tagText, cx - textWidth / 2, baseY - 50);

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
    const grid = toGrid(sx, sy);

    if (grid.x < 0 || grid.x > GRID_SIZE || grid.y < 0 || grid.y > GRID_SIZE) return;

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
        targetIndicator = { x: grid.x, y: grid.y, alpha: 1.0, parentSurface: clickedFurniture.id };
        return; // Don't place yet — now in "place on surface" mode
      }

      // Place furniture
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'PLACE_FURNITURE',
          payload: {
            type: selectedFurnitureType,
            x: grid.x,
            y: grid.y,
            elevation: parentSurfaceId ? 1 : 0,
            parentSurfaceId: parentSurfaceId || null
          }
        }));
      }
      // Clear parent surface selection after placing
      if (parentSurfaceId) parentSurfaceId = null;
    } else {
      // Walk to position
      targetIndicator = { x: grid.x, y: grid.y, alpha: 1.0 };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'MOVE',
          payload: { x: grid.x, y: grid.y }
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

  // --- Start Client ---
  // Check for persisted account token from localStorage
  const storedToken = localStorage.getItem('haven_token');
  if (storedToken) {
    authPlayerId = storedToken;
    selfId = storedToken;
  }

  initWebSocket(storedToken);
  requestAnimationFrame(gameLoop);
