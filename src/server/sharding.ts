/**
 * HavenWorld — Dynamic Room Sharding Engine (server-side).
 * Caps public spaces at MAX_CAPACITY (default 50) and spins up mirrored shards
 * (e.g. plaza_#2, plaza_#3) to prevent overcrowding.
 *
 * NOTE: Node 22 strip-only TS mode — no parameter properties, no `private` fields.
 */
import type { Room, RoomManager } from './rooms.ts';
import { cloneFurniture } from './rooms.ts';

export const DEFAULT_SHARD_CAPACITY = 50;

/** Check if a room identifier represents a shardable public room */
export function isShardableRoom(roomId: string, rooms: RoomManager): boolean {
  if (!roomId || roomId.startsWith('loft_') || roomId === 'sanctuary_loft') {
    return false;
  }
  const baseId = getBaseRoomId(roomId);
  const room = rooms.get(baseId);
  return !!room && room.isPublic;
}

/** Extract base room ID: e.g. "plaza_#2" -> "plaza", "plaza" -> "plaza" */
export function getBaseRoomId(roomId: string): string {
  const match = roomId.match(/^(.*?)_#\d+$/);
  return match ? match[1] : roomId;
}

/** Get shard index: e.g. "plaza_#2" -> 2, "plaza" -> 1 */
export function getShardIndex(roomId: string): number {
  const match = roomId.match(/_#(\d+)$/);
  return match ? parseInt(match[1], 10) : 1;
}

export class ShardManager {
  capacity: number;

  constructor(capacity: number = DEFAULT_SHARD_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * Find an available shard or spawn a new mirrored shard for a public room.
   */
  resolveShard(baseRoomId: string, rooms: RoomManager, capacity: number = this.capacity): string {
    const rootId = getBaseRoomId(baseRoomId);
    const baseRoom = rooms.get(rootId);
    if (!baseRoom || !baseRoom.isPublic) {
      return baseRoomId; // Private rooms or unlisted rooms do not shard
    }

    // Check base room (shard #1)
    if (baseRoom.players.size < capacity) {
      return rootId;
    }

    // Check existing mirrored shards (_#2, _#3, ...)
    let shardIndex = 2;
    while (true) {
      const shardId = `${rootId}_#${shardIndex}`;
      const existing = rooms.get(shardId);
      if (existing) {
        if (existing.players.size < capacity) {
          return shardId;
        }
        shardIndex += 1;
      } else {
        // Create new mirrored shard with identical furniture & aesthetics
        const newShard: Room = {
          id: shardId,
          name: `${baseRoom.name} #${shardIndex}`,
          isPublic: true,
          players: new Map(),
          furniture: cloneFurniture(baseRoom.furniture),
          ownerId: null,
          flooring: baseRoom.flooring,
          wallpaper: baseRoom.wallpaper,
        };
        rooms.rooms[shardId] = newShard;
        return shardId;
      }
    }
  }

  /**
   * Automatically prune empty mirrored shards (_#2, _#3, ...) when population drops to 0.
   * Shard #1 (the root room) is never pruned.
   */
  pruneEmptyShards(rooms: RoomManager): string[] {
    const pruned: string[] = [];
    for (const roomId of rooms.list()) {
      if (!roomId.includes('_#')) continue;
      const room = rooms.get(roomId);
      if (room && room.players.size === 0) {
        delete rooms.rooms[roomId];
        pruned.push(roomId);
      }
    }
    return pruned;
  }

  /**
   * List all active shards for a base room with occupancy metrics.
   */
  listShardsFor(baseRoomId: string, rooms: RoomManager): Array<{ id: string; name: string; occupants: number }> {
    const rootId = getBaseRoomId(baseRoomId);
    const results: Array<{ id: string; name: string; occupants: number }> = [];
    for (const roomId of rooms.list()) {
      if (getBaseRoomId(roomId) === rootId) {
        const room = rooms.get(roomId);
        if (room) {
          results.push({
            id: roomId,
            name: room.name,
            occupants: room.players.size,
          });
        }
      }
    }
    return results;
  }
}

export default { ShardManager, isShardableRoom, getBaseRoomId, getShardIndex };
