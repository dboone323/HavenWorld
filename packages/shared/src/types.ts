// Section 5.2 Core Data Models

export interface AvatarData {
  hair:        string;
  eyes:        string;
  top:         string;
  bottom:      string;
  shoes:       string;
  hat:         string;
  accessory:   string;
  skinTone:    string;
}

export type Direction = 'down' | 'up' | 'left' | 'right';

export interface PlayerState {
  id:         string;
  username:   string;
  x:          number;
  y:          number;
  direction:  Direction;
  isMoving:   boolean;
  avatar:     AvatarData;
  roomId:     string;
}

export interface ChatMessage {
  id:        string;
  playerId:  string;
  username:  string;
  text:      string;
  timestamp: number;
  roomId:    string;
}

export interface FurnitureState {
  id:       string;
  type:     string;
  x:        number;
  y:        number;
  depth:    number;
  ownerId:  string;
}

export interface RoomData {
  id:          string;
  name:        string;
  map:         string;   // tilemap key e.g. 'lobby', 'park'
  ownerId:     string | null;
  capacity:    number;
  players:     PlayerState[];
  furniture:   FurnitureState[];
}
