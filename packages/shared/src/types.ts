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

  /** 'male' | 'female' | 'unspecified' — drives body proportions and default hair. */
  gender?: string;

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

/**
 * Furniture placement payload.
 * `assetUrl` and the scale factors are optional: the server omits them when an
 * item has no uploaded GLB, and both client (`FurnitureManager`) and server
 * (`routes/rooms.ts`) fall back to `/assets/furniture/{itemId}.glb` and 1.0.
 */
export interface FurniturePlacementData {
  id: string;
  itemId: string;
  assetUrl?: string;
  placedById: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
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

export interface PlayerPosition3D {
  x: number;     // world-space meters, horizontal (left/right)
  y: number;     // world-space meters, vertical (height — usually 0 for ground)
  z: number;     // world-space meters, horizontal (forward/back)
  rotY: number;  // avatar facing direction in radians (Y-axis rotation)
}

/** player:move socket payload */
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
  map?: string;
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
  privacy?: RoomPrivacyMode;
  moodPreset?: string;
  awayMessage?: string | null;
}

// ── Phase 3 Systems ─────────────────────────────────────────────────────────

// §1 Fishing
export interface FishCatchData {
  id: string;
  userId: string;
  species: string;
  weightLbs: number;
  coinsEarned: number;
  caughtAt: string;
}

export interface FishingLeaderboardData {
  id: string;
  userId: string;
  username?: string;
  weightLbs: number;
  species: string;
  weekOf: string;
}

// §2 Loft Privacy & Doorbell
export type RoomPrivacyMode = 'PUBLIC' | 'FRIENDS_ONLY' | 'PASSWORD_PROTECTED' | 'LOCKED';

export interface RoomDecoratorData {
  id: string;
  roomId: string;
  userId: string;
  grantedAt: string;
}

export interface RoomAccessLogData {
  id: string;
  roomId: string;
  visitorId: string;
  visitorName?: string;
  visitedAt: string;
}

// §3 Guestbook & Tip Jar
export interface GuestbookEntryData {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  message: string;
  createdAt: string;
}

export interface TipTransactionData {
  id: string;
  senderId: string;
  senderName?: string;
  receiverId: string;
  amount: number;
  roomId: string;
  createdAt: string;
}

// §5 Anti-Scam P2P Trading
export type TradeStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface TradeOfferItem {
  slotIndex: number;
  inventoryItemId: string;
  name: string;
  assetUrl?: string;
}

export interface TradeStateData {
  tradeId: string;
  initiatorId: string;
  receiverId: string;
  initiatorItems: TradeOfferItem[];
  receiverItems: TradeOfferItem[];
  initiatorCoins: number;
  receiverCoins: number;
  initiatorReady: boolean;
  receiverReady: boolean;
  initiatorConfirmed: boolean;
  receiverConfirmed: boolean;
  state: 'OFFER_PHASE' | 'LOCKED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  countdownSeconds?: number;
}

// §6 Dual-Currency Economy & Shop
export interface DailyLoginStreakData {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string;
  claimedToday: boolean;
}

// §7 Pet Companions
export type PetType = 'CAT' | 'DOG' | 'BABY_DRAGON';
export type PetState = 'IDLE' | 'WANDER' | 'FOLLOW' | 'SLEEP' | 'REACT';

export interface PetData {
  id: string;
  ownerId: string;
  petType: PetType;
  name: string;
  happiness: number; // 0–100
  hunger: number;    // 0–100
  state: PetState;
  x?: number;
  y?: number;
  z?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
}

// §8 Pizza Chef
export interface PizzaOrderSubmitPayload {
  recipeId: string;
  ingredients: string[];
  durationMs: number;
}

// §9 Workshop Crafting
export interface MaterialInventoryData {
  scrapMetal: number;
  timber: number;
  fabric: number;
  crystalShard: number;
}

export interface CraftingQueueItemData {
  id: string;
  recipeId: string;
  recipeName?: string;
  startedAt: string;
  completesAt: string;
  claimed: boolean;
}

// §10 Passport & Achievements
export interface AchievementStampData {
  id: string;
  stamp: string;
  earnedAt: string;
}

export interface PassportData {
  userId: string;
  username: string;
  joinDate: string;
  isVIP: boolean;
  frameId: string;
  stamps: AchievementStampData[];
  fishCount: number;
  totalTips: number;
  completedTrades: number;
}

// §11 Loft Ambient Moods
export type MoodId =
  | 'day'
  | 'dusk'
  | 'night'
  | 'cyber_neon'
  | 'golden_hour'
  | 'haunted'
  | 'arctic'
  | 'cozy_evening';

// §12 Seasonal Events
export interface SeasonalEventData {
  id: string;
  name: string;
  theme: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

// §13 Clubs
export type ClubRole = 'OWNER' | 'OFFICER' | 'MEMBER';

export interface ClubData {
  id: string;
  name: string;
  motto?: string | null;
  tag?: string | null;
  ownerId: string;
  memberCount: number;
  createdAt: string;
}

export interface ClubMemberData {
  id: string;
  clubId: string;
  userId: string;
  username?: string;
  role: ClubRole;
  joinedAt: string;
}

// §15 Daily Quests
export interface DailyQuestProgressData {
  id: string;
  questId: string;
  title: string;
  description: string;
  progress: number;
  goal: number;
  completed: boolean;
  rewardCoins: number;
  rewardGems: number;
}

// §16 Photo Gallery
export interface GalleryPhotoData {
  id: string;
  authorId: string;
  authorName: string;
  imageUrl: string;
  caption?: string | null;
  likes: number;
  roomName: string;
  createdAt: string;
  isLikedByMe?: boolean;
}
