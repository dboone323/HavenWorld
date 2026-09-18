/**
 * HavenWorld — Multiplayer server entry (TypeScript).
 * Thin Express + HTTP + WebSocket bootstrap. Game logic lives in:
 *   - rooms.ts      : room registry + broadcast helpers (RoomManager)
 *   - protocol.ts   : WebSocket message dispatcher (handleMessage)
 *   - db.ts         : dual-mode persistence (Supabase / local SQLite)
 *   - moderation.ts : chat moderation pipeline
 *
 * Run: node src/server/server.ts (Node 26+ supports native TypeScript)
 */
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, serializePlayer, serializeRoom, getUserLoftRoomId } from './rooms.ts';
import { handleMessage } from './protocol.ts';
import { AuthorityTicker, AUTHORITY_TICK_MS } from './tick.ts';
import { TradeManager } from './trade.ts';
import { normalizeAvatar } from '../client/shared/identity-model.js';
import * as db from './db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
export const server = http.createServer(app);
export const wss = new WebSocketServer({ server });

export const rooms = new RoomManager();
export const globalPlayers = new Map<string, import('./rooms.ts').Player>();
export const tradeManager = new TradeManager();
// Authoritative 20Hz simulation: advances players server-side and emits
// compact PLAYER_DELTA frames. Started lazily on first listen (and exported
// for tests). Guarded so repeated imports / hot-reloads don't double-tick.
export const authorityTicker = new AuthorityTicker(rooms);
export function ensureAuthorityTick(): void {
  if (typeof process !== 'undefined' && process.env.HAVEN_NO_TICK === '1') return;
  if (!authorityTicker.running) authorityTicker.start();
}
// Auto-start on import so integration tests (which import without isMain)
// still exercise the live tick; HAVEN_NO_TICK=1 opts out.
ensureAuthorityTick();
let nextPlayerNumber = 101;

const PORT = process.env.PORT || 3000;

// Express middleware for JSON bodies
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true }));

// Client assets (Vite dist/ in prod, src/client/ in dev)
const clientDir = path.join(__dirname, '../../dist');
app.use(express.static(clientDir, {
  // Fallback to source for dev mode when dist/ doesn't exist
  fallthrough: true,
}));
// In dev (no dist/), serve from src/client/
const fallbackClientDir = path.join(__dirname, '../client');
app.use(express.static(fallbackClientDir));

// Shared isomorphic modules served to the browser as ESM (game.js imports them)
app.use('/shared', express.static(path.join(__dirname, '../shared'), {
  setHeaders: (res: http.ServerResponse, filePath: string) => {
    if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    }
  }
}));

// --- Legal & Compliance Pages ---
app.get('/terms', (req, res) => {
  const prodTerms = path.join(clientDir, 'terms.html');
  const devTerms = path.join(fallbackClientDir, 'terms.html');
  res.sendFile(fs.existsSync(prodTerms) ? prodTerms : devTerms);
});

app.get('/privacy', (req, res) => {
  const prodPrivacy = path.join(clientDir, 'privacy.html');
  const devPrivacy = path.join(fallbackClientDir, 'privacy.html');
  res.sendFile(fs.existsSync(prodPrivacy) ? prodPrivacy : devPrivacy);
});

// --- Diagnostics & Health Endpoints ---
app.get('/health', (req, res) => {
  res.redirect(301, '/api/health');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    memory: process.memoryUsage(),
    connections: wss.clients.size,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    onlinePlayers: globalPlayers.size,
    rooms: rooms.list().length,
    dbMode: db.getMode(),
    tickHz: Math.round(1000 / AUTHORITY_TICK_MS),
    tick: authorityTicker.tickCount,
    deltaBytesOut: authorityTicker.bytesOut,
    timestamp: Date.now()
  });
});

// --- Admin & Moderation Endpoints ---
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'haven_admin_secret_2026';

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization || '';
  const tokenHeader = req.headers['x-admin-secret'] as string || '';
  const querySecret = req.query.secret as string || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (querySecret === ADMIN_SECRET || tokenHeader === ADMIN_SECRET || token === ADMIN_SECRET) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized: invalid or missing admin secret.' });
  }
}

// Serve Admin Dashboard HTML
app.get('/admin', (req, res) => {
  const adminHtmlPath = path.join(__dirname, 'admin.html');
  if (fs.existsSync(adminHtmlPath)) {
    res.sendFile(adminHtmlPath);
  } else {
    res.status(404).send('Admin dashboard not found.');
  }
});

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const roomList = rooms.list().map(id => {
    const r = rooms.get(id);
    return {
      id,
      name: r?.name || id,
      playerCount: r?.players.size || 0,
      isPublic: r?.isPublic ?? true
    };
  });
  res.json({
    onlinePlayers: globalPlayers.size,
    totalRooms: rooms.list().length,
    rooms: roomList,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    dbMode: db.getMode()
  });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await db.listUsersForAdmin();
  res.json({ users });
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { banned, reason } = req.body;
  await db.setPlayerBan(id, Boolean(banned), reason);
  if (banned) {
    const activePlayer = globalPlayers.get(id);
    if (activePlayer && activePlayer.ws) {
      try {
        activePlayer.ws.send(JSON.stringify({
          type: 'banned',
          reason: reason || 'Suspended by admin.'
        }));
        activePlayer.ws.close(4003, 'Account suspended');
      } catch {}
    }
  }
  res.json({ success: true, playerId: id, banned: Boolean(banned) });
});

app.post('/api/admin/users/:id/mute', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { muted, durationMinutes } = req.body;
  const mutedUntil = (muted && durationMinutes)
    ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    : null;
  await db.setPlayerMute(id, Boolean(muted), mutedUntil);
  const activePlayer = globalPlayers.get(id);
  if (activePlayer) {
    activePlayer.isMuted = Boolean(muted);
    activePlayer.mutedUntil = mutedUntil;
  }
  res.json({ success: true, playerId: id, muted: Boolean(muted), mutedUntil });
});

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  const status = req.query.status as string || undefined;
  const reports = await db.listPlayerReports(status);
  res.json({ reports });
});

app.post('/api/admin/reports/:id/resolve', requireAdmin, async (req, res) => {
  const { id } = req.params;
  await db.resolvePlayerReport(id);
  res.json({ success: true, reportId: id, status: 'resolved' });
});

app.get('/api/admin/invites', requireAdmin, async (req, res) => {
  const invites = await db.listInviteCodes();
  res.json({ invites });
});

app.post('/api/admin/invites/generate', requireAdmin, async (req, res) => {
  const count = Math.min(Math.max(Number(req.body.count || 1), 1), 50);
  const maxUses = Math.max(Number(req.body.maxUses || 1), 1);
  const expiresDays = req.body.expiresDays ? Number(req.body.expiresDays) : null;
  const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400000).toISOString() : null;

  const generated = [];
  for (let i = 0; i < count; i++) {
    const inv = await db.createInviteCode({
      createdBy: 'admin_dashboard',
      expiresAt,
      maxUses
    });
    generated.push(inv);
  }
  res.json({ success: true, invites: generated });
});

// Player report submission endpoint (from client or API)
app.post('/api/report', async (req, res) => {
  const { reporterId, reportedId, reason, roomId } = req.body;
  if (!reporterId || !reportedId || !reason) {
    res.status(400).json({ success: false, error: 'reporterId, reportedId, and reason are required.' });
    return;
  }
  const report = await db.createPlayerReport(reporterId, reportedId, reason, roomId);
  res.json({ success: true, report });
});

// --- Auth API Endpoints ---

/**
 * POST /api/auth/signup
 * Body: { username: string, password: string, inviteCode?: string }
 * Returns: { success: true, playerId: string, name: string } | { success: false, error: string }
 */
app.post('/api/auth/signup', async (req, res) => {
  const { username, password, inviteCode } = req.body;
  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password are required.' });
    return;
  }

  const isInviteOnly = process.env.ALPHA_INVITE_ONLY === 'true' || process.env.ALPHA_INVITE_ONLY === '1';
  if (isInviteOnly || inviteCode) {
    if (!inviteCode) {
      res.status(400).json({ success: false, error: 'Alpha invite code is required to register during closed alpha.' });
      return;
    }
    const validation = await db.validateInviteCode(inviteCode);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.reason || 'Invalid alpha invite code.' });
      return;
    }
  }

  const result = await db.signupAccount(username, password);
  if ('error' in result) {
    res.status(409).json({ success: false, error: result.error });
    return;
  }

  if (inviteCode) {
    await db.consumeInviteCode(inviteCode, result.id);
  }

  // Create the player profile and avatar in DB
  await db.initPlayerProfile(result.id, result.name);
  res.json({ success: true, playerId: result.id, name: result.name });
});

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * Returns: { success: true, playerId: string, name: string } | { success: false, error: string }
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password are required.' });
    return;
  }
  const result = await db.loginAccount(username, password);
  if ('error' in result) {
    res.status(401).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, playerId: result.id, name: result.name });
});

/**
 * GET /api/auth/player/:playerId
 * Returns the player's persisted profile (name, coins, gems, avatar, lastDailyClaim).
 */
app.get('/api/auth/player/:playerId', async (req, res) => {
  const { playerId } = req.params;
  const profile = await db.loadPlayerProfile(playerId);
  if (!profile) {
    res.status(404).json({ success: false, error: 'Player not found.' });
    return;
  }
  res.json({ success: true, profile });
});

// --- WebSocket Connection Handler ---

wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
  try { await handleConnection(ws, req); }
  catch (e) { console.error('WebSocket connection error:', e instanceof Error ? e.message : e); }
});

// --- WebSocket Connection Handler ---

async function handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
  // Buffer any messages arriving while async DB queries and room setup execute
  const earlyMessageQueue: Buffer[] = [];
  let isReady = false;
  const onEarlyMessage = (data: Buffer) => {
    if (!isReady) {
      earlyMessageQueue.push(data);
    }
  };
  ws.on('message', onEarlyMessage);

  // Check for authentication token in the query string or headers.
  // Authenticated players use their persistent account ID;
  // unauthenticated players get a temporary guest ID (backward compatibility).
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const authToken = url.searchParams.get('token') || (req.headers['x-haven-token'] as string) || null;
  const guestToken = url.searchParams.get('guestId') || null;
  const nameParam = (url.searchParams.get('name') || '').trim();

  let playerId: string;
  let authUserId: string | null = null;

  if (authToken) {
    // The token is the player's persistent account ID
    playerId = authToken;
    authUserId = authToken;
  } else if (guestToken && (guestToken.startsWith('usr_') || guestToken.startsWith('guest_'))) {
    // Persistent guest session (stored in localStorage)
    playerId = guestToken;
  } else {
    // New guest session
    playerId = 'usr_' + Math.random().toString(36).substring(2, 9);
  }

  // Verify player moderation status (banned accounts are disconnected immediately)
  const modStatus = await db.getUserModerationStatus(playerId);
  if (modStatus.isBanned) {
    ws.send(JSON.stringify({
      type: 'banned',
      reason: modStatus.banReason || 'Your account has been suspended.'
    }));
    ws.close(4003, 'Account suspended');
    return;
  }

  const defaultName = nameParam || ('Traveler #' + (nextPlayerNumber++));

  // Try to load existing player profile from DB (works with account IDs)
  let playerName = defaultName;
  let playerCoins = 1000;
  let playerGems = 50;
  let playerLastDailyClaim = 0;
  let playerAvatar = {
    skin: '#f5cba7',
    hairStyle: 'cozy_messy',
    hairColor: '#4a235a',
    shirtColor: '#2e86c1',
    pantsColor: '#34495e'
  };

  const existingPlayer = await db.loadPlayerProfile(playerId);
  if (existingPlayer) {
    playerName = nameParam || existingPlayer.name || defaultName;
    playerCoins = existingPlayer.coins || 1000;
    playerGems = existingPlayer.gems || 50;
    playerLastDailyClaim = existingPlayer.lastDailyClaim || 0;
    if (existingPlayer.avatar) {
      playerAvatar = { ...playerAvatar, ...existingPlayer.avatar };
    }
  } else {
    // Ensure profile is persisted for new players
    await db.initPlayerProfile(playerId, playerName);
  }

  const identity = await db.loadIdentity(playerId);
  playerAvatar = normalizeAvatar(identity?.outfit || playerAvatar);
  const player = {
    identity: identity || undefined,
    id: playerId,
    name: playerName,
    room: 'plaza',
    x: 4.5,
    y: 7.5,
    targetX: 4.5,
    targetY: 7.5,
    coins: playerCoins,
    gems: playerGems,
    lastDailyClaim: playerLastDailyClaim,
    ws,
    avatar: playerAvatar,
    lastChat: null,
    friends: [] as string[],
    registeredAt: authUserId ? await db.getRegistrationDate(playerId) : null,
    authUserId,
    isVip: false,
    vipExpiresAt: null,
    materials: { scrap_metal: 0, timber: 0 },
    isMuted: modStatus.isMuted,
    mutedUntil: modStatus.mutedUntil,
    isBanned: false,
  };
  // Hydrate persisted room furniture for public/lobby rooms
  for (const roomId of rooms.list()) {
    const dbFurniture = await db.getRoomFurniture(roomId);
    if (dbFurniture && dbFurniture.length > 0) {
      rooms.setFurniture(roomId, dbFurniture);
    }
  }

  // Ensure the player has their own personal sanctuary loft.
  // 1. Create the DB room + starter furniture (if not already persisted)
  const dbLoft = await db.getUserSanctuaryRoom(playerId, playerName);
  // 2. Create the room in the RoomManager registry (lazily)
  const playerLoftId = getUserLoftRoomId(playerId);
  const loftRoom = await rooms.getUserLoft(playerId, playerName);
  // 3. Load furniture from DB and set it in the room registry
  if (dbLoft) {
    const dbLoftFurniture = await db.getLoftFurniture(dbLoft.roomId);
    if (dbLoftFurniture && dbLoftFurniture.length > 0) {
      rooms.setFurniture(loftRoom.id, dbLoftFurniture);
    }
    if (dbLoft.flooring || dbLoft.wallpaper) {
      rooms.setRoomStyle(loftRoom.id, dbLoft.flooring, dbLoft.wallpaper);
    }
    const exp = await db.getRoomExpansion(loftRoom.id);
    if (exp) {
      loftRoom.gridWidth = exp.width;
      loftRoom.gridHeight = exp.height;
    }
    const perm = await db.getRoomPermissions(loftRoom.id);
    if (perm) {
      loftRoom.accessMode = perm.accessMode as any;
      if (perm.passwordHash) loftRoom.passwordHash = perm.passwordHash;
    }
    const mood = await db.getRoomMood(loftRoom.id);
    if (mood) loftRoom.ambientMood = mood as any;
    const decs = await db.getRoomDecorators(loftRoom.id);
    if (decs) loftRoom.decorators = new Set(decs);
  }

  // Load VIP status and crafting materials
  const vipStatus = await db.getVipStatus(playerId);
  if (vipStatus.isVip) {
    player.isVip = true;
    player.vipExpiresAt = vipStatus.expiresAt;
  }
  const mats = await db.getPlayerMaterials(playerId);
  player.materials = mats;

  // Assign to initial room
  rooms.join('plaza', player);
  globalPlayers.set(playerId, player);
  const plaza = rooms.get('plaza');

  // Send welcome + initial state to the connecting client
  rooms.send(ws, {
    type: 'INIT_STATE',
    payload: {
      selfId: playerId,
      playerId: playerId,
      identity: player.identity,
      player: serializePlayer(player),
      room: serializeRoom(plaza!),
      otherPlayers: rooms.othersIn('plaza', playerId),
      // Inform the client about available personal lofts
      playerLoftRoomId: playerLoftId,
      playerLoftName: loftRoom.name
    }
  });

  // Notify others that the new player has arrived
  rooms.broadcast('plaza', { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, ws);

  // Notify online friends that player is online
  db.getFriends(playerId).then(friends => {
    for (const f of friends) {
      const friendPlayer = globalPlayers.get(f.friendId);
      if (friendPlayer?.ws) {
        rooms.send(friendPlayer.ws, {
          type: 'FRIEND_ONLINE',
          payload: { friendId: playerId, friendName: player.name }
        });
      }
    }
  }).catch(() => {});

  // Switch to active message dispatcher and drain any queued early messages
  isReady = true;
  ws.off('message', onEarlyMessage);

  const processMessage = async (raw: Buffer) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    await handleMessage(msg, player, {
      rooms, db, ws, globalPlayers, tradeManager,
      dailyCooldownMs: 24 * 60 * 60 * 1000,
    });
  };

  let dispatchQueue = Promise.resolve();
  ws.on('message', (raw) => {
    dispatchQueue = dispatchQueue.then(() => processMessage(raw as Buffer)).catch((error) => {
      console.error('Message dispatch failed:', error);
    });
  });

  for (const raw of earlyMessageQueue) {
    await processMessage(raw);
  }

  ws.on('close', () => {
    tradeManager.cancelPlayerTrade(playerId);
    rooms.broadcast(player.room, { type: 'PLAYER_LEFT', payload: { playerId: player.id } });
    rooms.leave(player);
    globalPlayers.delete(playerId);

    // Notify online friends that player disconnected
    db.getFriends(playerId).then(friends => {
      for (const f of friends) {
        const friendPlayer = globalPlayers.get(f.friendId);
        if (friendPlayer?.ws) {
          rooms.send(friendPlayer.ws, {
            type: 'FRIEND_OFFLINE',
            payload: { friendId: playerId, friendName: player.name }
          });
        }
      }
    }).catch(() => {});
  });
}

export { db };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 HavenWorld Multiplayer Server Online`);
    console.log(`📡 Local Web Client: http://localhost:${PORT}`);
    console.log(`🌐 Real-Time WebSockets active on port ${PORT}`);
    console.log(`🔐 Auth API: http://localhost:${PORT}/api/auth/signup  |  /api/auth/login`);
    if (db.isConfigured()) {
      console.log(`🗄️  Database: Connected to Supabase PostgreSQL`);
    } else {
      console.log(`💾  Database: ${db.getMode()} mode (add .env keys to enable Supabase)`);
    }
    console.log(`🏠  Each player gets a personal Sanctuary Loft (auto-created on connect)`);
    console.log(`⏰  Daily bonus: once per 24h with cooldown timer`);
    console.log(`====================================================`);
  });
}
