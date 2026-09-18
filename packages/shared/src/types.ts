// Core Data Models shared between client and server

export interface AvatarData {
  bodyType?: string;
  skinTone: string;
  hairStyle?: string;
  hairColor?: string;
  eyeStyle?: string;
  eyeColor?: string;
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
}

export type Direction = 'down' | 'up' | 'left' | 'right';

export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
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
