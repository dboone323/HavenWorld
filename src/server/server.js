const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, '../public')));

// In-memory Room State (Used directly or as cache for DB)
const rooms = {
  plaza: {
    id: 'plaza',
    name: 'Central Plaza & Lounge',
    isPublic: true,
    players: new Map(),
    furniture: [
      { id: 'f_bench1', type: 'bench', x: 2, y: 3, rotation: 0 },
      { id: 'f_bench2', type: 'bench', x: 7, y: 3, rotation: 0 },
      { id: 'f_fountain', type: 'fountain', x: 5, y: 5, rotation: 0 },
      { id: 'f_plant1', type: 'plant', x: 1, y: 1, rotation: 0 },
      { id: 'f_plant2', type: 'plant', x: 9, y: 1, rotation: 0 },
      { id: 'f_arcade', type: 'arcade', x: 8, y: 8, rotation: 0 }
    ]
  },
  sanctuary_loft: {
    id: 'sanctuary_loft',
    name: 'Cozy Personal Loft',
    isPublic: false,
    players: new Map(),
    furniture: [
      { id: 'f_sofa', type: 'sofa', x: 3, y: 4, rotation: 0 },
      { id: 'f_table', type: 'table', x: 5, y: 4, rotation: 0 },
      { id: 'f_tv', type: 'tv', x: 5, y: 2, rotation: 0 },
      { id: 'f_plant', type: 'plant', x: 2, y: 2, rotation: 0 },
      { id: 'f_neon', type: 'neon', x: 7, y: 1, rotation: 0 }
    ]
  }
};

let nextPlayerNumber = 101;

// Broadcast helper for a specific room
function broadcastToRoom(roomId, message, excludeWs = null) {
  const room = rooms[roomId];
  if (!room) return;
  const data = JSON.stringify(message);
  for (const [_, player] of room.players) {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

// Format player object without ws reference for transmission
function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    targetX: p.targetX,
    targetY: p.targetY,
    coins: p.coins,
    avatar: p.avatar,
    lastChat: p.lastChat
  };
}

wss.on('connection', async (ws) => {
  const playerId = 'usr_' + Math.random().toString(36).substring(2, 9);
  const defaultName = 'Traveler #' + (nextPlayerNumber++);

  // Initial Player State
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
    ws: ws,
    avatar: {
      skin: '#f5cba7',
      hairStyle: 'cozy_messy',
      hairColor: '#4a235a',
      shirtColor: '#2e86c1',
      pantsColor: '#34495e'
    },
    lastChat: null
  };

  // Ensure profile is persisted in DB
  await db.initPlayerProfile(playerId, defaultName);

  // Check if room furniture is already in Supabase
  if (db.isConfigured()) {
    const dbFurniture = await db.getRoomFurniture('sanctuary_loft');
    if (dbFurniture && dbFurniture.length > 0) {
      rooms.sanctuary_loft.furniture = dbFurniture;
    }
  }

  // Assign to initial room
  rooms.plaza.players.set(playerId, player);

  // Send Welcome & Initial State to Connecting Client
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    payload: {
      selfId: playerId,
      room: {
        id: rooms.plaza.id,
        name: rooms.plaza.name,
        furniture: rooms.plaza.furniture
      },
      player: serializePlayer(player),
      otherPlayers: Array.from(rooms.plaza.players.values())
        .filter(p => p.id !== playerId)
        .map(serializePlayer)
    }
  }));

  // Announce arrival to room peers
  broadcastToRoom('plaza', {
    type: 'PLAYER_JOINED',
    payload: { player: serializePlayer(player) }
  }, ws);

  // Message Handler
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      const currentRoom = rooms[player.room];
      if (!currentRoom) return;

      switch (msg.type) {
        case 'MOVE': {
          player.targetX = Math.max(0, Math.min(11, parseFloat(msg.payload.x) || player.x));
          player.targetY = Math.max(0, Math.min(11, parseFloat(msg.payload.y) || player.y));

          broadcastToRoom(player.room, {
            type: 'PLAYER_MOVED',
            payload: {
              playerId: player.id,
              startX: player.x,
              startY: player.y,
              targetX: player.targetX,
              targetY: player.targetY
            }
          });
          break;
        }

        case 'UPDATE_POSITION': {
          // Heartbeat position sync
          player.x = msg.payload.x;
          player.y = msg.payload.y;
          break;
        }

        case 'CHAT': {
          const rawText = String(msg.payload.text || '').trim().substring(0, 140);
          if (!rawText) return;

          // Check for chat command (e.g. /colour or /name)
          if (rawText.startsWith('/name ')) {
            const newName = rawText.replace('/name ', '').trim().substring(0, 18);
            if (newName) {
              player.name = newName;
              broadcastToRoom(player.room, {
                type: 'PLAYER_PROFILE_UPDATED',
                payload: { playerId: player.id, player: serializePlayer(player) }
              });
              return;
            }
          }

          player.lastChat = {
            text: rawText,
            timestamp: Date.now()
          };

          broadcastToRoom(player.room, {
            type: 'CHAT_MESSAGE',
            payload: {
              playerId: player.id,
              sender: player.name,
              text: rawText,
              timestamp: Date.now()
            }
          });
          break;
        }

        case 'UPDATE_AVATAR': {
          if (msg.payload.avatar) {
            player.avatar = { ...player.avatar, ...msg.payload.avatar };
          }
          if (msg.payload.name) {
            player.name = String(msg.payload.name).trim().substring(0, 18) || player.name;
          }

          // Persist to Supabase if configured
          if (db.isConfigured()) {
            await db.saveAvatar(player.id, player.avatar);
          }

          broadcastToRoom(player.room, {
            type: 'PLAYER_PROFILE_UPDATED',
            payload: { playerId: player.id, player: serializePlayer(player) }
          });
          break;
        }

        case 'SWITCH_ROOM': {
          const targetRoomId = msg.payload.roomId;
          if (!rooms[targetRoomId] || targetRoomId === player.room) return;

          // Remove from old room
          currentRoom.players.delete(player.id);
          broadcastToRoom(player.room, {
            type: 'PLAYER_LEFT',
            payload: { playerId: player.id }
          });

          // Add to new room
          player.room = targetRoomId;
          player.x = 5;
          player.y = 8;
          player.targetX = 5;
          player.targetY = 8;
          const newRoom = rooms[targetRoomId];
          newRoom.players.set(player.id, player);

          // Send new room state to player
          ws.send(JSON.stringify({
            type: 'ROOM_CHANGED',
            payload: {
              room: {
                id: newRoom.id,
                name: newRoom.name,
                furniture: newRoom.furniture
              },
              player: serializePlayer(player),
              otherPlayers: Array.from(newRoom.players.values())
                .filter(p => p.id !== player.id)
                .map(serializePlayer)
            }
          }));

          // Notify new room members
          broadcastToRoom(targetRoomId, {
            type: 'PLAYER_JOINED',
            payload: { player: serializePlayer(player) }
          }, ws);
          break;
        }

        case 'PLACE_FURNITURE': {
          if (player.room !== 'sanctuary_loft') return; // Only allow editing in personal sanctuary
          const { type, x, y } = msg.payload;
          const newItem = {
            id: 'f_' + Math.random().toString(36).substring(2, 9),
            type: type || 'plant',
            x: Math.round(x),
            y: Math.round(y),
            rotation: 0
          };
          currentRoom.furniture.push(newItem);

          // Persist to Supabase if configured
          if (db.isConfigured()) {
            await db.addFurniture(player.room, newItem);
          }

          broadcastToRoom(player.room, {
            type: 'FURNITURE_ADDED',
            payload: { item: newItem }
          });
          break;
        }

        case 'REMOVE_FURNITURE': {
          if (player.room !== 'sanctuary_loft') return;
          const { id } = msg.payload;
          const idx = currentRoom.furniture.findIndex(f => f.id === id);
          if (idx !== -1) {
            const removed = currentRoom.furniture.splice(idx, 1)[0];

            // Persist to Supabase if configured
            if (db.isConfigured()) {
              await db.removeFurniture(removed.id);
            }

            broadcastToRoom(player.room, {
              type: 'FURNITURE_REMOVED',
              payload: { id: removed.id }
            });
          }
          break;
        }

        case 'CLAIM_DAILY_BONUS': {
          player.coins += 250;
          if (db.isConfigured()) {
            await db.addCoins(player.id, 250);
          }
          ws.send(JSON.stringify({
            type: 'COINS_UPDATED',
            payload: { coins: player.coins, earned: 250, reason: 'Daily Sanctuary Bonus' }
          }));
          break;
        }

        case 'MINIGAME_SCORE': {
          const reward = Math.max(50, Math.min(500, Math.floor((msg.payload.score || 100) / 2)));
          player.coins += reward;
          if (db.isConfigured()) {
            await db.addCoins(player.id, reward);
          }
          ws.send(JSON.stringify({
            type: 'COINS_UPDATED',
            payload: { coins: player.coins, earned: reward, reason: 'Pizza Chef Payout' }
          }));
          // Announce accomplishment to room
          broadcastToRoom(player.room, {
            type: 'SYSTEM_ANNOUNCEMENT',
            payload: { text: `🍕 ${player.name} finished a shift at Pizza Chef and earned ${reward} HavenCoins!` }
          });
          break;
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // Disconnect Handler
  ws.on('close', () => {
    const r = rooms[player.room];
    if (r) {
      r.players.delete(playerId);
      broadcastToRoom(player.room, {
        type: 'PLAYER_LEFT',
        payload: { playerId: playerId }
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 HavenWorld / MiniWorld Multiplayer Server Online`);
  console.log(`📡 Local Web Client: http://localhost:${PORT}`);
  console.log(`🌐 Real-Time WebSockets active on port ${PORT}`);
  if (db.isConfigured()) {
    console.log(`🗄️ Database: Connected to Supabase PostgreSQL`);
  } else {
    console.log(`💾 Database: In-memory mode (add .env keys to enable Supabase)`);
  }
  console.log(`====================================================`);
});
