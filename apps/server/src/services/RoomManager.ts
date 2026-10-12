import type { PlayerState, ChatMessage, FurnitureState } from '@havenworld/shared';

export interface RoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const DEFAULT_ROOM_BOUNDS: RoomBounds = {
  minX: 0,
  maxX: 1200,
  minY: 0,
  maxY: 800,
};

export interface RoomCapacityLimits {
  softCap: number; // e.g. 25: normal players spill over to next shard once reached
  hardCap: number; // e.g. 30: absolute maximum capacity, VIPs can enter up to hardCap
}

export const DEFAULT_ROOM_CAPACITY: RoomCapacityLimits = {
  softCap: 25,
  hardCap: 30,
};

interface RoomState {
  players: Map<string, PlayerState>; // socketId → PlayerState
  chatHistory: ChatMessage[]; // last 50 messages (ring buffer)
  furniture: FurnitureState[]; // loaded from DB on first join
  loaded: boolean; // whether furniture was loaded from DB
  bounds: RoomBounds; // boundary collision constraints
}

class RoomManager {
  private rooms = new Map<string, RoomState>();
  private socketToRoom = new Map<string, string>(); // socketId → roomId
  private socketToUser = new Map<string, string>(); // socketId → userId
  private userToSocket = new Map<string, string>(); // userId → socketId
  private roomCapacity = new Map<string, RoomCapacityLimits>();
  private waitingQueues = new Map<string, string[]>(); // baseRoomId → array of userIds
  private admittedQueueUsers = new Set<string>(); // users permitted entry from queue

  // ── Room lifecycle ──────────────────────────────────────────────────────────
  private ensureRoom(roomId: string): RoomState {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        players: new Map(),
        chatHistory: [],
        furniture: [],
        loaded: false,
        bounds: { ...DEFAULT_ROOM_BOUNDS },
      });
    }
    return this.rooms.get(roomId)!;
  }

  // ── Player join / leave ─────────────────────────────────────────────────────
  joinRoom(roomId: string, socketId: string, player: PlayerState): void {
    const existingSocket = this.userToSocket.get(player.id);
    if (existingSocket && existingSocket !== socketId) {
      this.leaveRoom(existingSocket);
    }
    const room = this.ensureRoom(roomId);
    room.players.set(socketId, player);
    this.socketToRoom.set(socketId, roomId);
    this.socketToUser.set(socketId, player.id);
    this.userToSocket.set(player.id, socketId);
  }

  leaveRoom(socketId: string): { roomId: string; playerId: string } | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    const player = room?.players.get(socketId);
    const userId = this.socketToUser.get(socketId);

    room?.players.delete(socketId);
    this.socketToRoom.delete(socketId);
    this.socketToUser.delete(socketId);
    if (userId && this.userToSocket.get(userId) === socketId) {
      this.userToSocket.delete(userId);
    }

    // Public community space (Haven Park) is kept alive when empty
    // Personal lofts are cleaned up when empty to free memory
    if (room && room.players.size === 0 && roomId !== 'room-park') {
      this.rooms.delete(roomId);
    }

    // When an occupant leaves a room, if a waiting queue exists, admit next user
    const baseRoomId = roomId.split('#')[0];
    const queue = this.waitingQueues.get(baseRoomId);
    if (queue && queue.length > 0) {
      const nextUser = queue.shift();
      if (nextUser) {
        this.admittedQueueUsers.add(nextUser);
      }
    }

    return player ? { roomId, playerId: player.id } : null;
  }

  // ── Boundary clamping & constraints ────────────────────────────────────────
  setRoomBounds(roomId: string, bounds: Partial<RoomBounds>): RoomBounds {
    const room = this.ensureRoom(roomId);
    room.bounds = {
      minX: bounds.minX ?? room.bounds.minX,
      maxX: bounds.maxX ?? room.bounds.maxX,
      minY: bounds.minY ?? room.bounds.minY,
      maxY: bounds.maxY ?? room.bounds.maxY,
    };
    return room.bounds;
  }

  getRoomBounds(roomId: string): RoomBounds {
    return this.rooms.get(roomId)?.bounds ?? { ...DEFAULT_ROOM_BOUNDS };
  }

  clampPosition(roomId: string, x: number, y: number): { x: number; y: number } {
    const bounds = this.getRoomBounds(roomId);
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
    };
  }

  // ── Player movement ─────────────────────────────────────────────────────────
  movePlayer(
    socketId: string,
    x: number,
    y: number,
    direction: string,
    isMoving: boolean,
    z: number = 0,
    rotY: number = 0
  ): void {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return;
    const player = this.rooms.get(roomId)?.players.get(socketId);
    if (player) {
      const clamped = this.clampPosition(roomId, x, y);
      player.x = clamped.x;
      player.y = clamped.y;
      player.z = z;
      player.rotY = rotY;
      player.direction = direction as PlayerState['direction'];
      player.isMoving = isMoving;
      if (isMoving) {
        player.isSitting = false;
      }
    }
  }

  sitPlayer(
    socketId: string,
    x: number,
    y: number,
    z: number = 0,
    rotY: number = 0,
    isSitting: boolean = true
  ): void {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return;
    const player = this.rooms.get(roomId)?.players.get(socketId);
    if (player) {
      player.x = x;
      player.y = y;
      player.z = z;
      player.rotY = rotY;
      player.isMoving = false;
      player.isSitting = isSitting;
    }
  }

  // ── Chat history ────────────────────────────────────────────────────────────
  addChatMessage(roomId: string, message: ChatMessage): void {
    const room = this.ensureRoom(roomId);
    room.chatHistory.push(message);
    if (room.chatHistory.length > 50) {
      room.chatHistory.shift(); // keep last 50 — ring buffer
    }
  }

  // ── Furniture ───────────────────────────────────────────────────────────────
  setFurniture(roomId: string, furniture: FurnitureState[]): void {
    const room = this.ensureRoom(roomId);
    room.furniture = furniture;
    room.loaded = true;
  }

  addFurniture(roomId: string, item: FurnitureState): void {
    this.ensureRoom(roomId).furniture.push(item);
  }

  removeFurniture(roomId: string, furnitureId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.furniture = room.furniture.filter((f) => f.id !== furnitureId);
    }
  }

  isFurnitureLoaded(roomId: string): boolean {
    return this.rooms.get(roomId)?.loaded ?? false;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────
  getRoomState(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  getPlayerRoom(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  getUserId(socketId: string): string | undefined {
    return this.socketToUser.get(socketId);
  }

  getOccupantCount(roomId: string): number {
    return this.rooms.get(roomId)?.players.size ?? 0;
  }

  getAllRoomOccupants(): Map<string, number> {
    const result = new Map<string, number>();
    this.rooms.forEach((state, roomId) => {
      result.set(roomId, state.players.size);
    });
    return result;
  }

  getPlayer(userId: string): (PlayerState & { roomId: string }) | undefined {
    const socketId = this.userToSocket.get(userId);
    if (!socketId) return undefined;
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return undefined;
    const player = this.rooms.get(roomId)?.players.get(socketId);
    if (!player) return undefined;
    return { ...player, roomId };
  }

  // ── Capacity Soft-Caps & Overflow Sharding (Batch 39) ──────────────────────

  setRoomCapacityLimits(roomId: string, limits: Partial<RoomCapacityLimits>): RoomCapacityLimits {
    const existing = this.getRoomCapacityLimits(roomId);
    const updated: RoomCapacityLimits = {
      softCap: limits.softCap ?? existing.softCap,
      hardCap: limits.hardCap ?? existing.hardCap,
    };
    this.roomCapacity.set(roomId, updated);
    return updated;
  }

  getRoomCapacityLimits(roomId: string): RoomCapacityLimits {
    return this.roomCapacity.get(roomId) ?? { ...DEFAULT_ROOM_CAPACITY };
  }

  resolveTargetRoomInstance(
    baseRoomId: string,
    userId: string,
    isVip: boolean = false,
    maxShards: number = 5
  ): { targetRoomId: string; canEnter: boolean; queuePosition?: number; shardIndex: number } {
    const limits = this.getRoomCapacityLimits(baseRoomId);

    // If user was previously admitted from queue, let them into base room
    if (this.admittedQueueUsers.has(userId)) {
      this.admittedQueueUsers.delete(userId);
      return { targetRoomId: baseRoomId, canEnter: true, shardIndex: 1 };
    }

    // Iterate shards 1 to maxShards
    for (let i = 1; i <= maxShards; i++) {
      const shardId = i === 1 ? baseRoomId : `${baseRoomId}#${i}`;
      const count = this.getOccupantCount(shardId);

      // VIPs can enter up to hardCap, standard players up to softCap
      const allowedCap = isVip ? limits.hardCap : limits.softCap;
      if (count < allowedCap) {
        return { targetRoomId: shardId, canEnter: true, shardIndex: i };
      }
    }

    // All shards full -> enqueue player
    const pos = this.enqueueWaitingPlayer(baseRoomId, userId);
    return { targetRoomId: baseRoomId, canEnter: false, queuePosition: pos, shardIndex: 0 };
  }

  enqueueWaitingPlayer(baseRoomId: string, userId: string): number {
    let queue = this.waitingQueues.get(baseRoomId);
    if (!queue) {
      queue = [];
      this.waitingQueues.set(baseRoomId, queue);
    }
    const idx = queue.indexOf(userId);
    if (idx !== -1) return idx + 1;

    queue.push(userId);
    return queue.length;
  }

  dequeueWaitingPlayer(baseRoomId: string, userId: string): boolean {
    const queue = this.waitingQueues.get(baseRoomId);
    if (!queue) return false;
    const idx = queue.indexOf(userId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  getQueuePosition(baseRoomId: string, userId: string): number | null {
    const queue = this.waitingQueues.get(baseRoomId);
    if (!queue) return null;
    const idx = queue.indexOf(userId);
    return idx !== -1 ? idx + 1 : null;
  }

  listRoomShards(baseRoomId: string, maxShards = 5) {
    const limits = this.getRoomCapacityLimits(baseRoomId);
    const list = [];
    for (let i = 1; i <= maxShards; i++) {
      const shardId = i === 1 ? baseRoomId : `${baseRoomId}#${i}`;
      const occupants = this.getOccupantCount(shardId);
      list.push({
        roomId: shardId,
        shardIndex: i,
        occupants,
        softCap: limits.softCap,
        hardCap: limits.hardCap,
        isFull: occupants >= limits.hardCap,
      });
    }
    return list;
  }
}

export const roomManager = new RoomManager();
export { RoomManager };
