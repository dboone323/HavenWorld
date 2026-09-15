/**
 * HavenWorld — Room registry + broadcast helpers (server-side, ESM).
 * Extracted from the original monolithic server.js so room state and
 * serialization are unit-testable in isolation.
 */
import { WebSocket } from 'ws';

const WS_OPEN = WebSocket.OPEN;

const plazaFurniture = [
  { id: 'f_bench1', type: 'bench', x: 2, y: 3, rotation: 0 },
  { id: 'f_bench2', type: 'bench', x: 7, y: 3, rotation: 0 },
  { id: 'f_fountain', type: 'fountain', x: 5, y: 5, rotation: 0 },
  { id: 'f_plant1', type: 'plant', x: 1, y: 1, rotation: 0 },
  { id: 'f_plant2', type: 'plant', x: 9, y: 1, rotation: 0 },
  { id: 'f_arcade', type: 'arcade', x: 8, y: 8, rotation: 0 }
];

const loftFurniture = [
  { id: 'f_sofa', type: 'sofa', x: 3, y: 4, rotation: 0 },
  { id: 'f_table', type: 'table', x: 5, y: 4, rotation: 0 },
  { id: 'f_tv', type: 'tv', x: 5, y: 2, rotation: 0 },
  { id: 'f_plant', type: 'plant', x: 2, y: 2, rotation: 0 },
  { id: 'f_neon', type: 'neon', x: 7, y: 1, rotation: 0 }
];

function cloneFurniture(arr) {
  return arr.map(f => ({ ...f }));
}

/** Build a fresh room registry (with empty player Maps) so state is isolated. */
export function createDefaultRooms() {
  return {
    plaza: {
      id: 'plaza', name: 'Central Plaza & Lounge', isPublic: true,
      players: new Map(), furniture: cloneFurniture(plazaFurniture)
    },
    sanctuary_loft: {
      id: 'sanctuary_loft', name: 'Cozy Personal Loft', isPublic: false,
      players: new Map(), furniture: cloneFurniture(loftFurniture)
    }
  };
}

/** Project a player object into the shape transmitted to clients (drops `ws`). */
export function serializePlayer(p) {
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

export class RoomManager {
  constructor(rooms = null) {
    this.rooms = rooms || createDefaultRooms();
  }

  get(id) { return this.rooms[id]; }
  has(id) { return id in this.rooms; }
  list() { return Object.keys(this.rooms); }

  join(roomId, player) {
    const room = this.rooms[roomId];
    if (!room) return false;
    room.players.set(player.id, player);
    player.room = roomId;
    return true;
  }

  leave(player) {
    const room = this.rooms[player.room];
    if (room) room.players.delete(player.id);
  }

  broadcast(roomId, message, exclude = null) {
    const room = this.rooms[roomId];
    if (!room) return;
    const data = JSON.stringify(message);
    for (const p of room.players.values()) {
      if (p.ws !== exclude && p.ws.readyState === WS_OPEN) {
        p.ws.send(data);
      }
    }
  }

    send(ws, message) {
    if (ws && ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  othersIn(roomId, exceptId) {
    const room = this.rooms[roomId];
    if (!room) return [];
    return [...room.players.values()]
      .filter(p => p.id !== exceptId)
      .map(serializePlayer);
  }

  setFurniture(roomId, furniture) {
    const room = this.rooms[roomId];
    if (room) room.furniture = furniture;
  }

  addFurniture(roomId, item) {
    const room = this.rooms[roomId];
    if (room) { room.furniture.push(item); return true; }
    return false;
  }

  removeFurnitureById(roomId, id) {
    const room = this.rooms[roomId];
    if (!room) return null;
    const idx = room.furniture.findIndex(f => f.id === id);
    if (idx === -1) return null;
    return room.furniture.splice(idx, 1)[0];
  }

  clearFurniture(roomId) {
    const room = this.rooms[roomId];
    if (!room) return [];
    const removed = room.furniture.slice();
    room.furniture = [];
    return removed;
  }
}

export default { RoomManager, createDefaultRooms, serializePlayer };
