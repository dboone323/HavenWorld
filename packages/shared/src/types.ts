// Core Data Models shared between client and server

export interface AvatarData {
  bodyType?: number | string;
  height?: number;
  build?: number;
  skinTone?: string;
  skinColor?: string;
  hairStyle?: string;
  hairColor?: string;
  eyeStyle?: string;
  eyeColor?: string;
  topColor?: string;
  bottomColor?: string;
  outfitHead?: string | null;
  outfitFace?: string | null;
  outfitBody?: string | null;
  outfitLegs?: string | null;
  outfitFeet?: string | null;
  outfitBack?: string | null;
  outfitHand?: string | null;

  // Compatibility fields for client wardrobe & customizer
  hair?: string;
  eyes?: string;
  top?: string;
  bottom?: string;
  shoes?: string;
  hat?: string;
  accessory?: string;
  bodyMorphs?: Record<string, number>;
  [key: string]: unknown;
}

export interface Avatar3DData {
  bodyType: number;   // 0.0 (thin) to 1.0 (fat)
  height: number;     // 0.0 (short) to 1.0 (tall)
  build: number;      // 0.0 (slim) to 1.0 (muscular)
  skinTone: string;   // hex e.g. '#F5CBA7'
  hairColor: string;  // hex
  eyeColor: string;   // hex
  topColor: string;   // hex
  bottomColor: string;// hex
}

export interface FurniturePlacementData {
  id: string;
  itemId: string;
  assetUrl: string;
  placedById: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface FurniturePlacement {
  id: string;
  itemId: string;
  assetUrl?: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  isNew?: boolean;
  isRemoved?: boolean;
}

export type Direction = 'down' | 'up' | 'left' | 'right';

/**
 * 3D world-space position used by Babylon.js.
 * Units are meters. Y is the vertical axis (up).
 * rotY is the avatar's Y-axis rotation in radians.
 */
export interface PlayerPosition3D {
  x: number;     // world-space meters, horizontal (left/right)
  y: number;     // world-space meters, vertical (height — usually 0 for ground)
  z: number;     // world-space meters, horizontal (forward/back)
  rotY: number;  // avatar facing direction in radians (Y-axis rotation)
}

/** player:move socket payload — updated for 3D */
export interface PlayerMovePayload {
  roomId: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** player:join socket payload */
export interface PlayerJoinPayload {
  userId: string;
  username: string;
  position: PlayerPosition3D;
  avatarData: AvatarCustomizationData;
}

/** Avatar customization data shared between client and server */
export interface AvatarCustomizationData {
  skinColor: string;
  hairColor: string;
  eyeColor: string;
  bodyMorphs?: Record<string, number>;
}

export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  z?: number;
  rotY?: number;
  direction: Direction;
  isMoving: boolean;
  avatar: AvatarData;
  roomId?: string;
}

export interface ChatMessage {
  id: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  isFiltered?: boolean;
  timestamp: string | number;
  playerId?: string;
  username?: string;
  text?: string;
  roomId?: string;
}

export interface FurnitureState {
  id: string;
  itemId?: string;
  spriteKey?: string;
  x: number;
  y: number;
  z?: number;
  rotation?: number;
  layer?: number;
  type?: string;
  depth?: number;
  ownerId?: string;
}

export interface RoomData {
  id: string;
  name: string;
  description?: string;
  map?: string; // tilemap key e.g. 'lobby', 'park'
  backgroundKey?: string;
  ownerId?: string | null;
  capacity?: number;
  maxOccupants?: number;
  width?: number;
  height?: number;
  theme?: string;
  players?: PlayerState[];
  furniture?: FurnitureState[];
  chatHistory?: ChatMessage[];
  occupants?: number;
}
