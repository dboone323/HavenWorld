/**
 * HavenWorld — Multiplayer server entry (ESM).
 * Thin Express + HTTP + WebSocket bootstrap. Game logic lives in:
 *   - rooms.js      : room registry + broadcast helpers (RoomManager)
 *   - protocol.js   : WebSocket message dispatcher (handleMessage)
 *   - db.js         : dual-mode persistence (Supabase / local SQLite)
 *   - moderation.js : chat moderation pipeline
 *
 * Run: npm start
 */
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager, serializePlayer } from './rooms.js';
import { handleMessage } from './protocol.js';
import * as db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
export const server = http.createServer(app);
export const wss = new WebSocketServer({ server });

export const rooms = new RoomManager();
let nextPlayerNumber = 101;

const PORT = process.env.PORT || 3000;

// Client assets
app.use(express.static(path.join(__dirname, '../public')));
// Shared isomorphic modules served to the browser as ESM (game.js imports them)
app.use('/shared', express.static(path.join(__dirname, '../shared'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    }
  }
}));

wss.on('connection', async (ws) => {
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
    lastDailyClaim: 0,
    ws,
    avatar: {
      skin: '#f5cba7',
      hairStyle: 'cozy_messy',
      hairColor: '#4a235a',
      shirtColor: '#2e86c1',
      pantsColor: '#34495e'
    },
    lastChat: null
  };

  // Ensure profile is persisted
  await db.initPlayerProfile(playerId, defaultName);

  // Hydrate persisted room furniture (works in both sqlite & supabase modes)
  const dbFurniture = await db.getRoomFurniture('sanctuary_loft');
  if (dbFurniture && dbFurniture.length > 0) {
    rooms.setFurniture('sanctuary_loft', dbFurniture);
  }

  // Assign to initial room
  rooms.join('plaza', player);
  const plaza = rooms.get('plaza');

  // Send welcome + initial state to the connecting client
  rooms.send(ws, {
    type: 'INIT_STATE',
    payload: {
      selfId: playerId,
      room: { id: plaza.id, name: plaza.name, furniture: plaza.furniture },
      player: serializePlayer(player),
      otherPlayers: rooms.othersIn('plaza', playerId)
    }
  });

  // Notify others that the new player has arrived
  rooms.broadcast('plaza', { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, ws);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handleMessage(msg, player, { rooms, db, ws });
  });

  ws.on('close', () => {
    rooms.broadcast(player.room, { type: 'PLAYER_LEFT', payload: { playerId: player.id } });
    rooms.leave(player);
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
      console.log(`🗄️ Database: Connected to Supabase PostgreSQL`);
    } else {
      console.log(`💾 Database: ${db.getMode()} mode (add .env keys to enable Supabase)`);
    }
    console.log(`====================================================`);
  });
}
