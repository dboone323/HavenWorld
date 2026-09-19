export const SOCKET_EVENTS = {
  // Authentication & Session
  AUTH_JOIN:  'auth:join',
  AUTH_ERROR: 'auth:error',

  // Room & State
  ROOM_STATE:         'room:state',
  ROOM_PLAYER_JOINED: 'room:player_joined',
  ROOM_PLAYER_LEFT:   'room:player_left',

  // Player Movement
  PLAYER_MOVE:         'player:move',
  PLAYER_POSITION:     'player:position',
  POSITION_CORRECTION: 'player:position_correction',
  ERROR:               'error',

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

  // ── Phase 3: Fishing Mini-Game (§1) ──────────────────────────────────────
  CAST_LINE:      'fishing:cast_line',
  REEL_POSITION:  'fishing:reel_position',
  CANCEL_FISHING: 'fishing:cancel',
  FISH_BITE:      'fishing:bite',
  TENSION_UPDATE: 'fishing:tension_update',
  FISH_CAUGHT:    'fishing:caught',
  FISH_ESCAPED:   'fishing:escaped',

  // ── Phase 3: Loft Privacy & Doorbell (§2) ────────────────────────────────
  RING_DOORBELL:     'doorbell:ring',
  DOORBELL_DECISION: 'doorbell:decision',
  SET_ROOM_PRIVACY:  'room:set_privacy',
  GRANT_DECORATOR:   'room:grant_decorator',
  REVOKE_DECORATOR:  'room:revoke_decorator',
  DOORBELL_RING:     'doorbell:ring_notice',
  DOORBELL_RESULT:   'doorbell:result',
  PRIVACY_UPDATED:   'room:privacy_updated',

  // ── Phase 3: Guestbook & Tip Jar (§3) ────────────────────────────────────
  SIGN_GUESTBOOK:         'guestbook:sign',
  TIP_OWNER:              'tip:owner',
  GET_GUESTBOOK:          'guestbook:get',
  DELETE_GUESTBOOK_ENTRY: 'guestbook:delete',
  GUESTBOOK_PAGE:         'guestbook:page',
  GUESTBOOK_SIGNED:       'guestbook:signed',
  TIP_RECEIVED:           'tip:received',
  TIP_SUCCESS:            'tip:success',
  TIP_ERROR:              'tip:error',

  // ── Phase 3: Anti-Scam P2P Trading (§5) ──────────────────────────────────
  TRADE_REQUEST:      'trade:request',
  TRADE_ACCEPT:       'trade:accept',
  TRADE_DECLINE:      'trade:decline',
  OFFER_ITEM:         'trade:offer_item',
  OFFER_COINS:        'trade:offer_coins',
  TRADE_READY:        'trade:ready',
  TRADE_CONFIRM:      'trade:confirm',
  TRADE_CANCEL:       'trade:cancel',
  TRADE_REQUESTED:    'trade:requested',
  TRADE_STATE_UPDATE: 'trade:state_update',
  TRADE_COUNTDOWN:    'trade:countdown',
  TRADE_COMPLETE:     'trade:complete',
  TRADE_CANCELLED:    'trade:cancelled',

  // ── Phase 3: Shop & Dual Currency (§6) ───────────────────────────────────
  BUY_ITEM:           'shop:buy_item',
  GET_SHOP:           'shop:get',
  CLAIM_DAILY_LOGIN:  'economy:claim_daily_login',
  GIFT_ITEM:          'economy:gift_item',
  SHOP_STATE:         'shop:state',
  PURCHASE_SUCCESS:   'shop:purchase_success',
  PURCHASE_ERROR:     'shop:purchase_error',
  DAILY_REWARD:       'economy:daily_reward',
  FLASH_SALE_START:   'shop:flash_sale_start',
  GIFT_RECEIVED:      'economy:gift_received',

  // ── Phase 3: Pet Companions (§7) ─────────────────────────────────────────
  ADOPT_PET:            'pet:adopt',
  NAME_PET:             'pet:name',
  FEED_PET:             'pet:feed',
  EQUIP_PET_ACCESSORY:  'pet:equip_accessory',
  PET_STATE_UPDATE:     'pet:state_update',
  PET_REACT:            'pet:react',
  PET_HUNGER_LOW:       'pet:hunger_low',
  PET_ADOPTED:          'pet:adopted',

  // ── Phase 3: Pizza Chef Mini-Game (§8) ───────────────────────────────────
  PIZZA_ORDER_SUBMIT: 'minigame:pizza_submit',
  PIZZA_ORDER_RESULT: 'minigame:pizza_result',

  // ── Phase 3: Workshop Crafting & Recycling (§9) ──────────────────────────
  RECYCLE_ITEM:     'workshop:recycle_item',
  RECYCLE_BULK:     'workshop:recycle_bulk',
  START_CRAFT:      'workshop:start_craft',
  CLAIM_CRAFT:      'workshop:claim_craft',
  RECYCLE_RESULT:   'workshop:recycle_result',
  CRAFT_STARTED:    'workshop:craft_started',
  CRAFT_COMPLETE:   'workshop:craft_complete',
  MATERIALS_UPDATE: 'workshop:materials_update',

  // ── Phase 3: Passport & Achievements (§10) ───────────────────────────────
  ACHIEVEMENT_UNLOCKED: 'achievement:unlocked',

  // ── Phase 3: Loft Ambient Moods (§11) ────────────────────────────────────
  SET_ROOM_MOOD:     'room:set_mood',
  ROOM_MOOD_CHANGED: 'room:mood_changed',

  // ── Phase 3: Seasonal Events (§12) ───────────────────────────────────────
  SEASONAL_STATE:           'seasonal:state',
  SEASONAL_PROGRESS_UPDATE: 'seasonal:progress_update',

  // ── Phase 3: Player Clubs (§13) ──────────────────────────────────────────
  CLUB_INVITE:       'club:invite',
  CLUB_KICK:         'club:kick',
  CLUB_CHAT_SEND:    'club:chat_send',
  CLUB_CHAT_MESSAGE: 'club:chat_message',

  // ── Phase 3: Emote Wheel (§14) ───────────────────────────────────────────
  EMOTE_TRIGGERED: 'emote:triggered',
  AVATAR_EMOTE:    'avatar:emote',

  // ── Phase 3: Daily Quests (§15) ──────────────────────────────────────────
  QUEST_PROGRESS_UPDATE: 'quest:progress_update',
  QUEST_COMPLETE:        'quest:complete',

  // ── Phase 3: Photo Gallery (§16) ─────────────────────────────────────────
  PHOTO_LIKED: 'gallery:photo_liked',
} as const;

export type SocketEventType = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
