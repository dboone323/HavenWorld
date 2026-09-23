import { z } from 'zod';
import { hasNoMarkup } from '../validation/schemas';

/**
 * Zod validation schemas for every Socket.io event payload.
 * Applied at the top of each socket handler to prevent malformed data
 * from crashing the server or enabling XSS via unsanitized strings.
 */

// Reusable primitives
const uuid = z.string().uuid();
const safeString = (maxLen: number) =>
  z.string().min(1).max(maxLen).transform((s) => s.trim());
// Pet names are display text re-rendered in styled UI → reject markup outright
// (unlike chat/guestbook free text, which allows "<3" and relies on output escaping).
const petName = safeString(32).refine((s) => s.length > 0 && hasNoMarkup(s), {
  message: 'Pet name may not contain HTML markup (< >)',
});
const coord = z.number().finite().min(-10000).max(10000);

// ── Room join ──────────────────────────────────────────────────────────────────
export const JoinRoomSchema = z.object({
  roomId: z.string().min(1).max(128), // rooms use slug IDs, not necessarily UUIDs
});

// ── Player movement ────────────────────────────────────────────────────────────
export const MoveSchema = z.object({
  x: coord,
  y: coord,
  z: coord.optional().default(0),
  rotY: z.number().finite().optional().default(0),
  direction: z.enum(['up', 'down', 'left', 'right']).optional().default('down'),
  roomId: z.string().min(1).max(128),
  isMoving: z.boolean().optional().default(false),
});

// ── Chat ───────────────────────────────────────────────────────────────────────
export const ChatSchema = z.object({
  content: safeString(200),
  roomId: z.string().min(1).max(128).optional(),
});

// ── Furniture ─────────────────────────────────────────────────────────────────
export const FurniturePlaceSchema = z.object({
  roomId: z.string().min(1).max(128),
  placement: z.object({
    itemId: uuid,
    x: coord,
    y: coord,
    z: coord.optional().default(0),
    rotY: z.number().finite().optional().default(0),
    scaleX: z.number().min(0.1).max(10).optional().default(1),
    scaleY: z.number().min(0.1).max(10).optional().default(1),
    scaleZ: z.number().min(0.1).max(10).optional().default(1),
  }),
});

export const FurnitureRemoveSchema = z.object({
  roomId: z.string().min(1).max(128),
  furnitureId: uuid,
});

// ── Fishing ───────────────────────────────────────────────────────────────────
export const CastLineSchema = z.object({
  roomId: z.string().min(1).max(128),
});

export const ReelPositionSchema = z.object({
  value: z.number().min(0).max(1),
});

// ── Loft privacy ─────────────────────────────────────────────────────────────
export const SetPrivacySchema = z.object({
  roomId: z.string().min(1).max(128),
  mode: z.enum(['PUBLIC', 'FRIENDS_ONLY', 'PASSWORD_PROTECTED', 'LOCKED']),
  password: z.string().max(64).optional(),
  awayMessage: z.string().max(200).optional(),
});

export const DoorbellSchema = z.object({
  roomId: z.string().min(1).max(128),
});

export const DoorbellDecisionSchema = z.object({
  roomId: z.string().min(1).max(128),
  visitorId: uuid,
  admit: z.boolean(),
});

export const GrantDecoratorSchema = z.object({
  roomId: z.string().min(1).max(128),
  targetUserId: uuid,
});

// ── Guestbook & tip jar ───────────────────────────────────────────────────────
export const GuestbookSignSchema = z.object({
  roomId: z.string().min(1).max(128),
  message: safeString(300),
});

export const TipSchema = z.object({
  roomId: z.string().min(1).max(128),
  amount: z.number().int().min(1).max(10000),
});

export const GetGuestbookSchema = z.object({
  roomId: z.string().min(1).max(128),
  page: z.number().int().min(1).max(500).optional().default(1),
});

export const DeleteGuestbookEntrySchema = z.object({
  entryId: uuid,
});

// ── P2P Trading ───────────────────────────────────────────────────────────────
export const TradeRequestSchema = z.object({
  targetUserId: uuid,
});

export const OfferItemSchema = z.object({
  slotIndex: z.number().int().min(0).max(3),
  inventoryItemId: uuid,
  name: safeString(100),
  assetUrl: z.string().url().max(500).optional(),
});

export const OfferCoinsSchema = z.object({
  amount: z.number().int().min(0).max(1_000_000),
});

// ── Pets ──────────────────────────────────────────────────────────────────────
export const AdoptPetSchema = z.object({
  petType: z.enum(['CAT', 'DOG', 'BABY_DRAGON']),
  name: petName,
});

export const NamePetSchema = z.object({
  petId: uuid,
  name: petName,
});

export const FeedPetSchema = z.object({
  petId: uuid,
});

// ── Pizza mini-game ──────────────────────────────────────────────────────────
export const PizzaOrderSchema = z.object({
  recipe: z.enum(['margherita', 'funghi_rustica', 'green_garden', 'seasonal']),
  ingredients: z.array(z.string().max(50)).max(20),
  durationMs: z.number().int().min(0).max(120000),
});

// ── Workshop crafting ─────────────────────────────────────────────────────────
export const RecycleItemSchema = z.object({
  inventoryItemId: uuid,
});

export const StartCraftSchema = z.object({
  recipeId: uuid,
});

export const ClaimCraftSchema = z.object({
  craftingQueueId: uuid,
});

// ── Room mood ─────────────────────────────────────────────────────────────────
export const SetMoodSchema = z.object({
  roomId: z.string().min(1).max(128),
  mood: z.enum(['COZY', 'PARTY', 'SPOOKY', 'SERENE', 'ROMANTIC', 'TROPICAL', 'NONE']),
});

// ── Emotes ────────────────────────────────────────────────────────────────────
export const EmoteSchema = z.object({
  emoteId: z.string().min(1).max(64),
});

// ── Club chat ─────────────────────────────────────────────────────────────────
export const ClubChatSchema = z.object({
  clubId: uuid,
  content: safeString(300),
});
