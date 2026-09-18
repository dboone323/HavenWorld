import type { PlayerState, ChatMessage, FurnitureState } from '@havenworld/shared';

interface RoomState {
  players: Map<string, PlayerState>; // socketId → PlayerState
  chatHistory: ChatMessage[]; // last 50 messages (ring buffer)
  furniture: FurnitureState[]; // loaded from DB on first join
  loaded: boolean; // whether furniture was loaded from DB
}

class RoomManager {
  private rooms = new Map<string, RoomState>();
  private socketToRoom = new Map<string, string>(); // socketId → roomId
  private socketToUser = new Map<string, string>(); // socketId → userId

  // ── Room lifecycle ──────────────────────────────────────────────────────────
  private ensureRoom(roomId: string): RoomState {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        players: new Map(),
        chatHistory: [],
        furniture: [],
        loaded: false,
      });
    }
    return this.rooms.get(roomId)!;
  }

  // ── Player join / leave ─────────────────────────────────────────────────────
  joinRoom(roomId: string, socketId: string, player: PlayerState): void {
    const room = this.ensureRoom(roomId);
    room.players.set(socketId, player);
    this.socketToRoom.set(socketId, roomId);
    this.socketToUser.set(socketId, player.id);
  }

  leaveRoom(socketId: string): { roomId: string; playerId: string } | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    const player = room?.players.get(socketId);
    room?.players.delete(socketId);
    this.socketToRoom.delete(socketId);
    this.socketToUser.delete(socketId);

    // Public community space (Haven Park) is kept alive when empty
    // Personal lofts are cleaned up when empty to free memory
    if (room && room.players.size === 0 && roomId !== 'room-park') {
      this.rooms.delete(roomId);
    }
    return player ? { roomId, playerId: player.id } : null;
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
      player.x = x;
      player.y = y;
      player.z = z;
      player.rotY = rotY;
      player.direction = direction as PlayerState['direction'];
      player.isMoving = isMoving;
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
    for (const [roomId, room] of this.rooms) {
      for (const player of room.players.values()) {
        if (player.id === userId) {
          return { ...player, roomId };
        }
      }
    }
    return undefined;
  }
}

export const roomManager = new RoomManager();
