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
import { RoomManager, serializePlayer } from './rooms.ts';
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

wss.on('connection', async (ws: WebSocket) => {
  const playerId = 'usr_' + Math.random().toString(36).substring(2, 9);
  const defaultName = 'Traveler #' + (nextPlayerNumber++);

  const player = {
    id: playerId,
    name: defaultName,
    room: 'plaza',
    x: 4.5,
    y: 7.5,
    targetX: 4.5,
    targetY: 7.5,
    coins: 1000,
    gems: 50,
    lastDailyClaim: 0,
    ws,
    avatar: {
      skin: '#f5cba7',
      hairStyle: 'cozy_messy',
      hairColor: '#4a235a',
      shirtColor: '#2e86c1',
      pantsColor: '#34495e'
    },
    lastChat: null,
    friends: [] as string[],
  };

  // Ensure profile is persisted
  await db.initPlayerProfile(playerId, defaultName);

  // Try to load existing player profile from DB
  const existingPlayer = await db.loadPlayerProfile(playerId);
  if (existingPlayer) {
    player.name = existingPlayer.name || defaultName;
    player.coins = existingPlayer.coins || 1000;
    player.gems = existingPlayer.gems || 50;
    player.lastDailyClaim = existingPlayer.lastDailyClaim || 0;
    if (existingPlayer.avatar) {
      player.avatar = { ...player.avatar, ...existingPlayer.avatar };
    }
  }

  // Hydrate persisted room furniture (works in both sqlite & supabase modes)
  for (const roomId of rooms.list()) {
    const dbFurniture = await db.getRoomFurniture(roomId);
    if (dbFurniture && dbFurniture.length > 0) {
      rooms.setFurniture(roomId, dbFurniture);
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
      room: { id: plaza!.id, name: plaza!.name, furniture: plaza!.furniture },
      player: serializePlayer(player),
      otherPlayers: rooms.othersIn('plaza', playerId)
    }
  });

  // Notify others that the new player has arrived
  rooms.broadcast('plaza', { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, ws);

  ws.on('message', (raw: Buffer) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(msg, player, { rooms, db, ws, globalPlayers });
  });

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
    if (db.isConfigured()) {
      console.log(`🗄️  Database: Connected to Supabase PostgreSQL`);
    } else {
      console.log(`💾  Database: ${db.getMode()} mode (add .env keys to enable Supabase)`);
    }
    console.log(`====================================================`);
  });
}
