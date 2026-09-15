/**
 * HavenWorld — WebSocket message dispatcher (ESM).
 * Maps a client message `{ type, payload }` to room-state mutations and
 * outbound events. `db` calls are self-noops in memory mode.
 */
import { clampGrid } from '../shared/iso.mjs';
import { parseCommand, moderateChat } from './moderation.js';
import { serializePlayer } from './rooms.js';

const GRID_MAX = 11;

/**
 * @param {{type:string,payload:any}} msg   parsed client message
 * @param {object} player                   mutable player state (has .ws)
 * @param {{rooms:object, db:object, ws:object}} ctx
 */
export function handleMessage(msg, player, ctx) {
  const { rooms, db } = ctx;
  const room = player.room;
  const currentRoom = rooms.get(room);
  if (!currentRoom) return;

  switch (msg.type) {
    case 'MOVE': {
      const { x, y } = msg.payload || {};
      player.targetX = clampGrid(Number(x) || player.x, GRID_MAX);
      player.targetY = clampGrid(Number(y) || player.y, GRID_MAX);
      rooms.broadcast(room, {
        type: 'PLAYER_MOVED',
        payload: { playerId: player.id, startX: player.x, startY: player.y, targetX: player.targetX, targetY: player.targetY }
      });
      break;
    }

    case 'UPDATE_POSITION': {
      player.x = msg.payload.x;
      player.y = msg.payload.y;
      break;
    }

    case 'CHAT': {
      const raw = (msg.payload && msg.payload.text) || '';
      const { text } = moderateChat(raw);
      if (!text) return;

      // In-game commands: /name <n>
      if (text.startsWith('/')) {
        const cmd = parseCommand(text);
        if (cmd && cmd.command === 'name' && cmd.args) {
          player.name = cmd.args.slice(0, 18);
          rooms.broadcast(room, {
            type: 'PLAYER_PROFILE_UPDATED',
            payload: { playerId: player.id, player: serializePlayer(player) }
          });
        }
        return;
      }

      player.lastChat = { text, timestamp: Date.now() };
      rooms.broadcast(room, {
        type: 'CHAT_MESSAGE',
        payload: { playerId: player.id, sender: player.name, text, timestamp: Date.now() }
      });
      break;
    }

    case 'UPDATE_AVATAR': {
      if (msg.payload && msg.payload.avatar) Object.assign(player.avatar, msg.payload.avatar);
      if (msg.payload && msg.payload.name) {
        player.name = String(msg.payload.name).trim().slice(0, 18) || player.name;
      }
      db.saveAvatar(player.id, player.avatar).catch(() => {});
      rooms.broadcast(room, {
        type: 'PLAYER_PROFILE_UPDATED',
        payload: { playerId: player.id, player: serializePlayer(player) }
      });
      break;
    }

    case 'SWITCH_ROOM': {
      const targetRoomId = msg.payload && msg.payload.roomId;
      if (!rooms.has(targetRoomId) || targetRoomId === player.room) return;
      rooms.broadcast(player.room, { type: 'PLAYER_LEFT', payload: { playerId: player.id } }, player.ws);
      rooms.leave(player);
      player.room = targetRoomId;
      player.x = 5; player.y = 8; player.targetX = 5; player.targetY = 8;
      rooms.join(targetRoomId, player);
      const target = rooms.get(targetRoomId);
      rooms.send(player.ws, {
        type: 'ROOM_CHANGED',
        payload: {
          room: { id: target.id, name: target.name, furniture: target.furniture },
          player: serializePlayer(player),
          otherPlayers: rooms.othersIn(targetRoomId, player.id)
        }
      });
      rooms.broadcast(targetRoomId, { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, player.ws);
      break;
    }

    case 'CLEAR_ROOM': {
      if (player.room !== 'sanctuary_loft') return;
      const removed = rooms.clearFurniture(player.room);
      for (const f of removed) db.removeFurniture(f.id).catch(() => {});
      rooms.broadcast(player.room, { type: 'ROOM_CLEARED' });
      break;
    }

    case 'PLACE_FURNITURE': {
      if (player.room !== 'sanctuary_loft') return;
      const { type, x, y } = msg.payload || {};
      const newItem = {
        id: 'f_' + Math.random().toString(36).substring(2, 9),
        type: type || 'plant', x: Math.round(x), y: Math.round(y), rotation: 0
      };
      currentRoom.furniture.push(newItem);
      db.addFurniture(player.room, newItem).catch(() => {});
      rooms.broadcast(player.room, { type: 'FURNITURE_ADDED', payload: { item: newItem } });
      break;
    }

    case 'REMOVE_FURNITURE': {
      if (player.room !== 'sanctuary_loft') return;
      const { id } = msg.payload || {};
      const removed = rooms.removeFurnitureById(player.room, id);
      if (removed) {
        db.removeFurniture(removed.id).catch(() => {});
        rooms.broadcast(player.room, { type: 'FURNITURE_REMOVED', payload: { id: removed.id } });
      }
      break;
    }

    case 'CLAIM_DAILY_BONUS': {
      player.coins += 250;
      db.addCoins(player.id, 250).catch(() => {});
      rooms.send(player.ws, {
        type: 'COINS_UPDATED',
        payload: { coins: player.coins, earned: 250, reason: 'Daily Sanctuary Bonus' }
      });
      break;
    }

    case 'MINIGAME_SCORE': {
      const reward = Math.max(50, Math.min(500, Math.floor((msg.payload.score || 100) / 2)));
      player.coins += reward;
      db.addCoins(player.id, reward).catch(() => {});
      rooms.send(player.ws, {
        type: 'COINS_UPDATED',
        payload: { coins: player.coins, earned: reward, reason: 'Pizza Chef Payout' }
      });
      rooms.broadcast(room, {
        type: 'SYSTEM_ANNOUNCEMENT',
        payload: { text: `🍕 ${player.name} finished a shift at Pizza Chef and earned ${reward} HavenCoins!` }
      });
      break;
    }

    default:
      break;
  }
}

export default { handleMessage };
