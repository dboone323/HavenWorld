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
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, serializePlayer, serializeRoom, getUserLoftRoomId } from './rooms.ts';
import { handleMessage } from './protocol.ts';
import * as db from './db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
export const server = http.createServer(app);
export const wss = new WebSocketServer({ server });

export const rooms = new RoomManager();
export const globalPlayers = new Map<string, import('./rooms.ts').Player>();
let nextPlayerNumber = 101;

const PORT = process.env.PORT || 3000;

// Express middleware for JSON bodies (used by auth API endpoints)
app.use(express.json({ limit: '1kb' }));
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

// --- Auth API Endpoints ---

/**
 * POST /api/auth/signup
 * Body: { username: string, password: string }
 * Returns: { success: true, playerId: string, name: string } | { success: false, error: string }
 */
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password are required.' });
    return;
  }
  const result = await db.signupAccount(username, password);
  if ('error' in result) {
    res.status(409).json({ success: false, error: result.error });
    return;
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

  const defaultName = 'Traveler #' + (nextPlayerNumber++);

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
    playerName = existingPlayer.name || defaultName;
    playerCoins = existingPlayer.coins || 1000;
    playerGems = existingPlayer.gems || 50;
    playerLastDailyClaim = existingPlayer.lastDailyClaim || 0;
    if (existingPlayer.avatar) {
      playerAvatar = { ...playerAvatar, ...existingPlayer.avatar };
    }
  } else {
    // Ensure profile is persisted for new players
    await db.initPlayerProfile(playerId, defaultName);
  }

  const player = {
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
    authUserId,
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
  }

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
      rooms, db, ws, globalPlayers,
      dailyCooldownMs: 24 * 60 * 60 * 1000,
    });
  };

  ws.on('message', processMessage);

  for (const raw of earlyMessageQueue) {
    await processMessage(raw);
  }

  ws.on('close', () => {
    rooms.broadcast(player.room, { type: 'PLAYER_LEFT', payload: { playerId: player.id } });
    rooms.leave(player);
    globalPlayers.delete(playerId);
  });
});

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
