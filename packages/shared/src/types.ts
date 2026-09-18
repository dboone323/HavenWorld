export interface AvatarData {
  gender?: string;
  skinTone?: string;
  body?: string;
  eyes?: string;
  hairStyle?: string;
  hairColor?: string;
  clothingTop?: string;
  clothingBottom?: string;
  shoes?: string;
  accessory?: string;
  layers?: Record<string, string>;
}

export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  facing?: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
  state?: 'idle' | 'walking' | 'sitting' | 'dancing';
  roomId?: string;
  avatar: AvatarData;
}

export interface RoomFurniture {
  id: string;
  itemId: string;
  x: number;
  y: number;
  rotation: number;
}

export interface RoomData {
  id: string;
  name: string;
  type: 'public' | 'personal';
  capacity: number;
  tilemap?: string;
  players: Record<string, PlayerState>;
  furniture: RoomFurniture[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  roomId: string;
  message: string;
  timestamp: number;
  isWhisper?: boolean;
  targetId?: string;
}
