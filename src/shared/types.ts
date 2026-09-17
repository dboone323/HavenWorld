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

/** GET_FRIENDS_LIST — request the player's friends list and pending requests */
export interface FriendsListPayload {}

/** SEND_FRIEND_REQUEST — request to add another player as a friend */
export interface SendFriendRequestPayload {
  targetName: string;         // look up by name
}

/** ACCEPT_FRIEND_REQUEST — accept an incoming friend request */
export interface AcceptFriendRequestPayload {
  requesterId: string;
}

/** SEND_PRIVATE_MESSAGE — send a whisper to a friend */
export interface SendPrivateMessagePayload {
  targetPlayerId: string;
  text: string;
}

export interface PlayerEmotePayload {
  emote: 'hug' | 'wave' | 'heart';
  targetPlayerId?: string;
  targetPlayerName?: string;
}

export interface UpdateRoomStylePayload {
  roomId: string;
  flooring?: string;
  wallpaper?: string;
}

export interface InteractFurniturePayload {
  furnitureId: string;
  action: 'sit' | 'toggle' | 'stand';
}

export type ClientMessage =
  | { type: 'JOIN_ROOM'; payload: JoinRoomPayload }
  | { type: 'MOVE_TO'; payload: MoveToPayload }
  | { type: 'MOVE_REQUEST'; payload: MoveToPayload }
  | { type: 'UPDATE_POSITION'; payload: { x: number; y: number } }
  | { type: 'SEND_CHAT'; payload: SendChatPayload }
  | { type: 'PLACE_ITEM'; payload: PlaceItemPayload }
  | { type: 'MOVE_ITEM'; payload: MoveItemPayload }
  | { type: 'REMOVE_ITEM'; payload: RemoveItemPayload }
  | { type: 'MINIGAME_SCORE'; payload: MinigameScorePayload }
  | { type: 'CLAIM_DAILY_BONUS'; payload: null }
  | { type: 'GET_DAILY_COOLDOWN'; payload: null }
  | { type: 'CLEAR_ROOM'; payload: null }
  | { type: 'UPDATE_IDENTITY'; payload: { title?: string; statusMessage?: string; pinnedBadges?: string[] } }
  | { type: 'SAVE_PRESET'; payload: { slot: number; avatar?: Partial<Avatar> } }
  | { type: 'APPLY_PRESET'; payload: { slot: number } }
  | { type: 'UPDATE_AVATAR'; payload: { avatar?: Partial<Avatar>; name?: string } }
  | { type: 'SWITCH_ROOM'; payload: JoinRoomPayload }
  | { type: 'GET_FRIENDS_LIST'; payload: null }
  | { type: 'SEND_FRIEND_REQUEST'; payload: SendFriendRequestPayload }
  | { type: 'ACCEPT_FRIEND_REQUEST'; payload: AcceptFriendRequestPayload }
  | { type: 'SEND_PRIVATE_MESSAGE'; payload: SendPrivateMessagePayload }
  | { type: 'GET_PRIVATE_MESSAGES'; payload: null }
  | { type: 'PLAYER_EMOTE'; payload: PlayerEmotePayload }
  | { type: 'UPDATE_ROOM_STYLE'; payload: UpdateRoomStylePayload }
  | { type: 'INTERACT_FURNITURE'; payload: InteractFurniturePayload }
  | { type: 'GET_ROOM_DIRECTORY'; payload: null }
  | { type: 'TRADE_REQUEST'; payload: { targetPlayerId: string } }
  | { type: 'TRADE_ACCEPT'; payload: { tradeId: string } }
  | { type: 'TRADE_UPDATE_OFFER'; payload: { tradeId: string; coins: number; items: string[] } }
  | { type: 'TRADE_LOCK'; payload: { tradeId: string; locked: boolean } }
  | { type: 'TRADE_CONFIRM'; payload: { tradeId: string } }
  | { type: 'TRADE_CANCEL'; payload: { tradeId: string } };

/* ── Outbound (Server → Client) ───────────────────────────────── */

export interface PlayerInfo {
  title?: string;
  statusMessage?: string;
  pinnedBadges?: string[];
  registeredAt?: string | null;
  isRegistered?: boolean;
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  coins: number;
  gems: number;
  avatar: Avatar;
  lastChat: ChatBubble | null;
  isSitting?: boolean;
  facing?: 'NE' | 'SE' | 'SW' | 'NW';
}

export interface IdentityState {
  title: string;
  statusMessage: string;
  pinnedBadges: string[];
  presets: (Avatar | null)[];
  outfit: Avatar | null;
  passport: {
    playerId: string; playerName: string; joinedAt: number;
    visitedRooms: string[]; unlockedStamps: Record<string, number>;
    stats: { stepsTaken: number; pizzasBaked: number; furniPlaced: number; emotesSent: number };
  };
}

export interface Avatar {
  shoesColor?: string;
  eyeColor?: string;
  eyeStyle?: string;
  hat?: string;
  shirtStyle?: string;
  pantsStyle?: string;
  shoesStyle?: string;
  aura?: string;
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
  w?: number;                 // multi-tile footprint width (default 1)
  h?: number;                 // multi-tile footprint height (default 1)
  heightClass?: 'floor' | 'rug' | 'low' | 'avatar' | 'tall';
  state?: {
    isOn?: boolean;
    [key: string]: unknown;
  };
}

export interface RoomInfo {
  id: string;
  name: string;
  furniture: PlacedFurniture[];
  flooring?: string;
  wallpaper?: string;
}

/* ── Convenience types ── */

export interface InventoryItem {
  item_type: string;
  quantity: number;
}

export interface ShopItem {
  name: string;
  price: number;
  category: 'furniture' | 'clothing';
  icon: string;
}

/* ── Friends & Private Messaging Payloads ── */

export interface FriendEntry {
  friendId: string;
  /** Display name when the friend is known online; falls back to friendId. */
  name?: string;
  /** Sanitized "Currently doing..." status, empty when unset. */
  statusMessage?: string;
  status: string;
  createdAt: string;
}

export interface PendingRequest {
  requesterId: string;
  createdAt: string;
}

export interface FriendsListUpdatePayload {
  friends: FriendEntry[];
  pendingRequests: PendingRequest[];
}

export interface FriendRequestReceivedPayload {
  fromPlayerId: string;
  fromPlayerName: string;
}

export interface MessageRecord {
  senderId: string;
  text: string;
  sentAt: string;
}

export interface PrivateMessageReceivedPayload {
  fromPlayerId: string;
  fromPlayerName: string;
  text: string;
  timestamp: number;
}

export interface PrivateMessagesListPayload {
  messages: MessageRecord[];
}

export type ServerMessage =
  | { type: 'ROOM_STATE'; payload: { room: RoomInfo; player: PlayerInfo; otherPlayers: PlayerInfo[] } }
  | { type: 'PLAYER_JOINED'; payload: { player: PlayerInfo } }
  | { type: 'PLAYER_LEFT'; payload: { playerId: string } }
  | { type: 'PLAYER_MOVED'; payload: { playerId: string; startX: number; startY: number; targetX: number; targetY: number; speed?: number; isSitting?: boolean; facing?: 'NE' | 'SE' | 'SW' | 'NW' } }
  | { type: 'PLAYER_DELTA'; payload: { deltas: [id: string, x: number, y: number, facing: number, stateMask: number][]; tick: number } }
  | { type: 'RECONCILE_POSITION'; payload: { x: number; y: number; targetX: number; targetY: number } }
  | { type: 'MOVE_REJECTED'; payload: { reason: string; targetX: number; targetY: number } }
  | { type: 'CHAT_MESSAGE'; payload: { playerId: string; sender: string; text: string; channel?: string; timestamp: number; } }
  | { type: 'ROOM_CHANGED'; payload: { room: RoomInfo; player: PlayerInfo; otherPlayers: PlayerInfo[] } }
  | { type: 'FURNITURE_ADDED'; payload: { item: PlacedFurniture } }
  | { type: 'FURNITURE_REMOVED'; payload: { id: string } }
  | { type: 'FURNITURE_STATE_UPDATED'; payload: { furnitureId: string; state: Record<string, unknown> } }
  | { type: 'ROOM_CLEARED'; payload: null }
  | { type: 'COINS_UPDATED'; payload: { coins: number; earned: number; reason: string } }
  | { type: 'SYSTEM_ANNOUNCEMENT'; payload: { text: string } }
  | { type: 'IDENTITY_UPDATED'; payload: IdentityState }
  | { type: 'IDENTITY_ERROR'; payload: { message: string } }
  | { type: 'PLAYER_PROFILE_UPDATED'; payload: { playerId: string; player: PlayerInfo } }
  | { type: 'INIT_STATE'; payload: { playerId: string; player: PlayerInfo; room: RoomInfo; otherPlayers: PlayerInfo[]; playerLoftRoomId?: string; playerLoftName?: string } }
  // Friends & Private Messaging
  | { type: 'FRIENDS_LIST_UPDATE'; payload: FriendsListUpdatePayload }
  | { type: 'FRIEND_REQUEST_SENT'; payload: { message: string; targetPlayerId?: string } }
  | { type: 'FRIEND_REQUEST_RECEIVED'; payload: FriendRequestReceivedPayload }
  | { type: 'FRIEND_REQUEST_ACCEPTED'; payload: { message: string; friendId?: string } }
  | { type: 'FRIEND_REQUEST_ERROR'; payload: { message: string } }
  | { type: 'PRIVATE_MESSAGE_RECEIVED'; payload: PrivateMessageReceivedPayload }
  | { type: 'PRIVATE_MESSAGE_ERROR'; payload: { message: string } }
  | { type: 'PRIVATE_MESSAGES_LIST'; payload: PrivateMessagesListPayload }
  // Daily Bonus
  | { type: 'DAILY_BONUS_ERROR'; payload: { message: string; lastClaim: number; nextClaimAvailable: number } }
  | { type: 'DAILY_COOLDOWN_UPDATE'; payload: { canClaim: boolean; lastClaim: number; nextClaimAvailable: number; timeRemainingMs: number } }
  // Furniture errors
  | { type: 'FURNITURE_ERROR'; payload: { message: string } }
  // Social & Room Customization
  | { type: 'PLAYER_EMOTED'; payload: { fromPlayerId: string; fromPlayerName: string; emote: string; targetPlayerId?: string; targetPlayerName?: string; text: string } }
  | { type: 'ROOM_STYLE_UPDATED'; payload: { roomId: string; flooring: string; wallpaper: string } }
  // Room Directory
  | { type: 'ROOM_DIRECTORY_UPDATE'; payload: { publicRooms: { id: string; name: string; description: string; count: number }[]; personalLofts: { id: string; ownerId: string; ownerName: string; name: string; statusMessage?: string; count: number }[] } }
  // Trading
  | { type: 'TRADE_REQUEST_RECEIVED'; payload: { tradeId: string; fromPlayerId: string; fromPlayerName: string } }
  | { type: 'TRADE_REQUEST_SENT'; payload: { tradeId: string; targetPlayerId: string; targetPlayerName: string } }
  | { type: 'TRADE_STARTED'; payload: { tradeId: string; session: unknown; partnerName: string } }
  | { type: 'TRADE_UPDATED'; payload: { tradeId: string; session: unknown } }
  | { type: 'TRADE_COMPLETED'; payload: { tradeId: string; message: string } }
  | { type: 'TRADE_CANCELED'; payload: { tradeId: string; reason: string } }
  | { type: 'TRADE_ERROR'; payload: { message: string } };

/* ── Convenience: narrow a typed payload from a raw envelope ── */
export type ClientMessageOf<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
