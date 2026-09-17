import type { IdentityState } from '../shared/types.ts';

/**
 * HavenWorld — Room registry + broadcast helpers (server-side, TypeScript).
 * Extracted from the original monolithic server.js so room state and
 * serialization are unit-testable in isolation.
 */
import { WebSocket } from 'ws';
import type { PlayerInfo, PlacedFurniture, RoomInfo, Avatar } from '../shared/types.ts';

const WS_OPEN = WebSocket.OPEN;

export interface Player {
  identity?: IdentityState;
  id: string;
  name: string;
  room: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  facing?: 'NE' | 'SE' | 'SW' | 'NW';
  isSitting?: boolean;
  isWalking?: boolean;
  walkCycle?: number;
  lastMoveAt?: number;
  lastTickX?: number;
  lastTickY?: number;
  coins: number;
  gems: number;
  lastDailyClaim: number;
  ws: WebSocket;
  avatar: Avatar;
  lastChat: { text: string; timestamp: number } | null;
  friends: string[];
  registeredAt?: string | null;
  authUserId: string | null; // Supabase auth user ID (if logged in via account)
}

export interface Room {
  id: string;
  name: string;
  isPublic: boolean;
  players: Map<string, Player>;
  furniture: PlacedFurniture[];
  ownerId: string | null; // for private per-user rooms
  flooring: string;       // e.g. 'marble', 'parquet', 'plush_carpet', 'slate'
  wallpaper: string;      // e.g. 'slate', 'cozy_wood', 'brick', 'pastel'
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
      players: new Map(), furniture: cloneFurniture(plazaFurniture), ownerId: null,
      flooring: 'marble', wallpaper: 'slate',
    },
    sanctuary_loft: {
      id: 'sanctuary_loft', name: 'Cozy Personal Loft', isPublic: false,
      players: new Map(), furniture: cloneFurniture(loftFurniture), ownerId: null,
      flooring: 'parquet', wallpaper: 'cozy_wood',
    },
  };
}

/** Project a room object into the shape transmitted to clients. */
export function serializeRoom(room: Room): RoomInfo {
  return {
    id: room.id,
    name: room.name,
    furniture: room.furniture,
    flooring: room.flooring || 'parquet',
    wallpaper: room.wallpaper || 'cozy_wood',
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
    facing: p.facing,
    isSitting: p.isSitting,
    coins: p.coins,
    gems: p.gems,
    avatar: p.avatar,
    lastChat: p.lastChat,
    registeredAt: p.registeredAt ?? null,
    isRegistered: !!p.authUserId,
    title: p.identity?.title || '',
    statusMessage: p.identity?.statusMessage || '',
    pinnedBadges: p.identity?.pinnedBadges || [],
  };
}

/**
 * Derive a per-user sanctuary loft room ID from a player ID.
 * e.g. "usr_a1b2c3d4" -> "loft_a1b2c3d4"
 */
export function getUserLoftRoomId(playerId: string): string {
  // Derive a stable loft room ID from the player ID.
  // For usr_ prefixed IDs: loft_<chars_after_usr_>
  // For non-prefixed IDs (supabase UUIDs): loft_<first_12_chars>
  const suffix = playerId.replace(/^usr_/, '').substring(0, 12);
  return `loft_${suffix}`;
}

export class RoomManager {
  rooms: Record<string, Room>;

  constructor(rooms: Record<string, Room> | null = null) {
    this.rooms = rooms || createDefaultRooms();
  }

  get(id: string): Room | undefined { return this.rooms[id]; }
  has(id: string): boolean { return id in this.rooms; }
  list(): string[] { return Object.keys(this.rooms); }

  /**
   * Get or create a personal sanctuary loft for a player.
   * The room is created lazily (on demand) so that each player gets
   * their own private space with their own furniture.
   */
  async getUserLoft(playerId: string, playerName: string): Promise<Room> {
    const roomId = getUserLoftRoomId(playerId);
    if (this.rooms[roomId]) return this.rooms[roomId];

    // Create loft with default starter furnishings (can be overridden by caller from DB)
    const starterFurn = [
      { id: 'f_sofa_' + Math.random().toString(36).substring(2, 9), type: 'sofa', x: 3, y: 4, rotation: 0, elevation: 0, parentSurfaceId: null },
      { id: 'f_table_' + Math.random().toString(36).substring(2, 9), type: 'table', x: 5, y: 4, rotation: 0, elevation: 0, parentSurfaceId: null },
      { id: 'f_tv_' + Math.random().toString(36).substring(2, 9), type: 'tv', x: 5, y: 2, rotation: 0, elevation: 0, parentSurfaceId: null },
      { id: 'f_plant_' + Math.random().toString(36).substring(2, 9), type: 'plant', x: 2, y: 2, rotation: 0, elevation: 0, parentSurfaceId: null },
      { id: 'f_neon_' + Math.random().toString(36).substring(2, 9), type: 'neon', x: 7, y: 1, rotation: 0, elevation: 0, parentSurfaceId: null },
    ];
    this.rooms[roomId] = {
      id: roomId,
      name: `${playerName}'s Personal Sanctuary Loft`,
      isPublic: false,
      players: new Map(),
      furniture: starterFurn,
      ownerId: playerId,
      flooring: 'parquet',
      wallpaper: 'cozy_wood',
    };
    return this.rooms[roomId];
  }

  /**
   * Check whether a room is a personal loft (private per-user sanctuary).
   */
  isUserLoft(roomId: string): boolean {
    return roomId.startsWith('loft_') && roomId !== 'sanctuary_loft';
  }

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

  setRoomStyle(roomId: string, flooring?: string, wallpaper?: string): void {
    const room = this.rooms[roomId];
    if (room) {
      if (flooring) room.flooring = flooring;
      if (wallpaper) room.wallpaper = wallpaper;
    }
  }

  clearFurniture(roomId: string): PlacedFurniture[] {
    const room = this.rooms[roomId];
    if (!room) return [];
    const removed = room.furniture.slice();
    room.furniture = [];
    return removed;
  }
}

export default { RoomManager, createDefaultRooms, serializePlayer, serializeRoom, getUserLoftRoomId };
