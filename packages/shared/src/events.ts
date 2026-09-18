export const SOCKET_EVENTS = {
  // Connection / Lifecycle
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',

  // Authentication & Session
  AUTH_REQUEST: 'auth:request',
  AUTH_SUCCESS: 'auth:success',
  AUTH_FAILURE: 'auth:failure',

  // Room & State
  ROOM_JOIN: 'room:join',
  ROOM_JOINED: 'room:joined',
  ROOM_LEAVE: 'room:leave',
  ROOM_STATE: 'room:state',
  ROOM_SYNC: 'room:sync',

  // Player Movement & State
  PLAYER_MOVE: 'player:move',
  PLAYER_MOVED: 'player:moved',
  PLAYER_STATE: 'player:state',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',

  // Chat & Communication
  CHAT_MESSAGE: 'chat:message',
  CHAT_BROADCAST: 'chat:broadcast',
  CHAT_WHISPER: 'chat:whisper',

  // Friends & Social
  FRIEND_REQUEST: 'friend:request',
  FRIEND_STATUS: 'friend:status',

  // Room Items & Furniture
  FURNITURE_PLACE: 'furniture:place',
  FURNITURE_MOVE: 'furniture:move',
  FURNITURE_REMOVE: 'furniture:remove',
  FURNITURE_UPDATE: 'furniture:update',
} as const;

export type SocketEventType = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
