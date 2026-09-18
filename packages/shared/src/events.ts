// Section 5.2 Socket Event Constants — exactly 14 events
export const SOCKET_EVENTS = {
  // Authentication & Session
  AUTH_JOIN:  'auth:join',
  AUTH_ERROR: 'auth:error',

  // Room & State
  ROOM_STATE:         'room:state',
  ROOM_PLAYER_JOINED: 'room:player_joined',
  ROOM_PLAYER_LEFT:   'room:player_left',

  // Player Movement
  PLAYER_MOVE:     'player:move',
  PLAYER_POSITION: 'player:position',

  // Chat
  CHAT_SEND:    'chat:send',
  CHAT_MESSAGE: 'chat:message',
  CHAT_ERROR:   'chat:error',

  // Avatar
  AVATAR_UPDATE:  'avatar:update',
  AVATAR_CHANGED: 'avatar:changed',

  // Friends
  FRIEND_ONLINE:  'friend:online',
  FRIEND_OFFLINE: 'friend:offline',

  // Furniture (Part 5B)
  ROOM_FURNITURE_UPDATED: 'room:furniture_updated',
  FURNITURE_PLACE:        'furniture:place',
  FURNITURE_REMOVE:       'furniture:remove',
} as const;

export type SocketEventType = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
