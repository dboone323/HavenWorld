/**
 * HavenWorld — Room registry + broadcast helpers (server-side, TypeScript).
 * Extracted from the original monolithic server.js so room state and
 * serialization are unit-testable in isolation.
 */
import { WebSocket } from 'ws';
import type { PlayerInfo, PlacedFurniture, RoomInfo, Avatar } from '../shared/types.ts';

const WS_OPEN = WebSocket.OPEN;

export interface Player {
  id: string;
  name: string;
  room: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  coins: number;
  gems: number;
  lastDailyClaim: number;
  ws: WebSocket;
  avatar: Avatar;
  lastChat: { text: string; timestamp: number } | null;
  friends: string[];
}

export interface Room {
  id: string;
  name: string;
  isPublic: boolean;
  players: Map<string, Player>;
  furniture: PlacedFurniture[];
}

const plazaFurniture: PlacedFurniture[] = [
  { id: 'f_bench1', type: 'bench', x: 2, y: 3, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_bench2', type: 'bench', x: 7, y: 3, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_fountain', type: 'fountain', x: 5, y: 5, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_plant1', type: 'plant', x: 1, y: 1, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_plant2', type: 'plant', x: 9, y: 1, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_arcade', type: 'arcade', x: 8, y: 8, rotation: 0, elevation: 0, parentSurfaceId: null },
];

const loftFurniture: PlacedFurniture[] = [
  { id: 'f_sofa', type: 'sofa', x: 3, y: 4, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_table', type: 'table', x: 5, y: 4, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_tv', type: 'tv', x: 5, y: 2, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_plant', type: 'plant', x: 2, y: 2, rotation: 0, elevation: 0, parentSurfaceId: null },
  { id: 'f_neon', type: 'neon', x: 7, y: 1, rotation: 0, elevation: 0, parentSurfaceId: null },
];

function cloneFurniture(arr: PlacedFurniture[]): PlacedFurniture[] {
  return arr.map((f) => ({ ...f }));
}

/** Build a fresh room registry (with empty player Maps) so state is isolated. */
export function createDefaultRooms(): Record<string, Room> {
  return {
    plaza: {
      id: 'plaza', name: 'Central Plaza & Lounge', isPublic: true,
      players: new Map(), furniture: cloneFurniture(plazaFurniture)
    },
    sanctuary_loft: {
      id: 'sanctuary_loft', name: 'Cozy Personal Loft', isPublic: false,
      players: new Map(), furniture: cloneFurniture(loftFurniture)
    },
  };
}

/** Project a player object into the shape transmitted to clients (drops `ws`). */
export function serializePlayer(p: Player): PlayerInfo {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    targetX: p.targetX,
    targetY: p.targetY,
    coins: p.coins,
    gems: p.gems,
    avatar: p.avatar,
    lastChat: p.lastChat,
  };
}

export class RoomManager {
  rooms: Record<string, Room>;

  constructor(rooms: Record<string, Room> | null = null) {
    this.rooms = rooms || createDefaultRooms();
  }

  get(id: string): Room | undefined { return this.rooms[id]; }
  has(id: string): boolean { return id in this.rooms; }
  list(): string[] { return Object.keys(this.rooms); }

  join(roomId: string, player: Player): boolean {
    const room = this.rooms[roomId];
    if (!room) return false;
    room.players.set(player.id, player);
    player.room = roomId;
    return true;
  }

  leave(player: Player): void {
    const room = this.rooms[player.room];
    if (room) room.players.delete(player.id);
  }

  broadcast(roomId: string, message: Record<string, unknown>, exclude: WebSocket | null = null): void {
    const room = this.rooms[roomId];
    if (!room) return;
    const data = JSON.stringify(message);
    for (const p of room.players.values()) {
      if (p.ws !== exclude && p.ws.readyState === WS_OPEN) {
        p.ws.send(data);
      }
    }
  }

  send(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws && ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  othersIn(roomId: string, exceptId: string): PlayerInfo[] {
    const room = this.rooms[roomId];
    if (!room) return [];
    return [...room.players.values()]
      .filter((p) => p.id !== exceptId)
      .map(serializePlayer);
  }

  setFurniture(roomId: string, furniture: PlacedFurniture[]): void {
    const room = this.rooms[roomId];
    if (room) room.furniture = furniture;
  }

  addFurniture(roomId: string, item: PlacedFurniture): boolean {
    const room = this.rooms[roomId];
    if (room) { room.furniture.push(item); return true; }
    return false;
  }

  removeFurnitureById(roomId: string, id: string): PlacedFurniture | null {
    const room = this.rooms[roomId];
    if (!room) return null;
    const idx = room.furniture.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    return room.furniture.splice(idx, 1)[0];
  }

  clearFurniture(roomId: string): PlacedFurniture[] {
    const room = this.rooms[roomId];
    if (!room) return [];
    const removed = room.furniture.slice();
    room.furniture = [];
    return removed;
  }
}

export default { RoomManager, createDefaultRooms, serializePlayer };
