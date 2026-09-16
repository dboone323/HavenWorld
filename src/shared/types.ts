/**
 * HavenWorld — Shared WebSocket Protocol Types
 *
 * Single source of truth for the client↔server JSON messaging vocabulary.
 * Derived from docs/05_SYSTEM_ARCHITECTURE_AND_NETWORKING.md §2 and the
 * switch-based dispatcher in src/server/protocol.js.
 *
 * Usage:
 *   import type { ClientMessage, ServerMessage } from '../shared/types.ts';
 *   — or via relative import from src/shared/types.ts
 */

/* ── Envelope ────────────────────────────────────────── */

export interface MessageEnvelope {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/* ── Inbound (Client → Server) ───────────────────────────────── */

/** JOIN_ROOM — enter a specific room */
export interface JoinRoomPayload {
  roomId: string;
  password: string | null;
}

/** MOVE_TO — player clicks a destination tile */
export interface MoveToPayload {
  targetX: number;            // grid X, 0..GRID_MAX
  targetY: number;            // grid Y, 0..GRID_MAX
}

/** SEND_CHAT — player submits text */
export interface SendChatPayload {
  text: string;
  channel: 'room' | 'whisper';
}

/** PLACE_ITEM — place furniture in an owned room */
export interface PlaceItemPayload {
  itemId: string;             // item definition (e.g. "sofa_retro_01")
  gridX: number;
  gridY: number;
  rotation: 0 | 90 | 180 | 270;
  parentSurfaceId: string | null;  // surface parenting (table, shelf)
}

/** MOVE_ITEM — relocate or rotate placed furniture */
export interface MoveItemPayload {
  placedItemId: string;       // instance id of placed furniture
  gridX: number;
  gridY: number;
  rotation: 0 | 90 | 180 | 270;
}

/** REMOVE_ITEM — return placed furniture to inventory */
export interface RemoveItemPayload {
  placedItemId: string;
}

/** MINIGAME_SCORE — report mini-game completion */
export interface MinigameScorePayload {
  gameId: string;             // e.g. "pizza_chef"
  score: number;
  accuracy: number;           // 0..1
  checksum: string;           // anti-cheat hash
}

export type ClientMessage =
  | { type: 'JOIN_ROOM'; payload: JoinRoomPayload }
  | { type: 'MOVE_TO'; payload: MoveToPayload }
  | { type: 'UPDATE_POSITION'; payload: { x: number; y: number } }
  | { type: 'SEND_CHAT'; payload: SendChatPayload }
  | { type: 'PLACE_ITEM'; payload: PlaceItemPayload }
  | { type: 'MOVE_ITEM'; payload: MoveItemPayload }
  | { type: 'REMOVE_ITEM'; payload: RemoveItemPayload }
  | { type: 'MINIGAME_SCORE'; payload: MinigameScorePayload }
  | { type: 'CLAIM_DAILY_BONUS'; payload: null }
  | { type: 'UPDATE_AVATAR'; payload: { avatar?: Partial<Avatar>; name?: string } }
  | { type: 'SWITCH_ROOM'; payload: JoinRoomPayload }
  | { type: 'CLEAR_ROOM'; payload: null };

/* ── Outbound (Server → Client) ───────────────────────────────── */

export interface PlayerInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  coins: number;
  avatar: Avatar;
  lastChat: ChatBubble | null;
}

export interface Avatar {
  skin: string;
  hairStyle: string;
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
  accessory?: string;
  statusMessage?: string;
}

export interface ChatBubble {
  text: string;
  timestamp: number;
}

export interface PlacedFurniture {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation: number;
  elevation?: number;          // 0 = floor, >0 = raised (optional for backward compat)
  parentSurfaceId?: string | null;
}

export interface RoomInfo {
  id: string;
  name: string;
  furniture: PlacedFurniture[];
}

export type ServerMessage =
  | { type: 'ROOM_STATE'; payload: { room: RoomInfo; player: PlayerInfo; otherPlayers: PlayerInfo[] } }
  | { type: 'PLAYER_JOINED'; payload: { player: PlayerInfo } }
  | { type: 'PLAYER_LEFT'; payload: { playerId: string } }
  | { type: 'PLAYER_MOVED'; payload: { playerId: string; startX: number; startY: number; targetX: number; targetY: number; speed: number } }
  | { type: 'CHAT_MESSAGE'; payload: { playerId: string; sender: string; text: string; channel: string; timestamp: number; } }
  | { type: 'ROOM_CHANGED'; payload: { room: RoomInfo; player: PlayerInfo; otherPlayers: PlayerInfo[] } }
  | { type: 'FURNITURE_ADDED'; payload: { item: PlacedFurniture } }
  | { type: 'FURNITURE_REMOVED'; payload: { id: string } }
  | { type: 'ROOM_CLEARED'; payload: null }
  | { type: 'COINS_UPDATED'; payload: { coins: number; earned: number; reason: string } }
  | { type: 'SYSTEM_ANNOUNCEMENT'; payload: { text: string } }
  | { type: 'PLAYER_PROFILE_UPDATED'; payload: { playerId: string; player: PlayerInfo } }
  | { type: 'INIT_STATE'; payload: { playerId: string; player: PlayerInfo; room: RoomInfo; otherPlayers: PlayerInfo[] } };

/* ── Convenience: narrow a typed payload from a raw envelope ── */
export type ClientMessageOf<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
