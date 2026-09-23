import { z } from 'zod';
import xss from 'xss';

// ── Reusable Field Validators ───────────────────────────────────────────────
export const UUIDField = z.string().uuid('Must be a valid UUID');
export const UUIDArray = z.array(UUIDField).min(1).max(20);

export const SanitizedString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .transform((val) => xss(val.trim(), { whiteList: {}, stripIgnoreTag: true }));

// ── Auth Schemas ────────────────────────────────────────────────────────────
export const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username cannot exceed 20 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  email: z.string().email('Invalid email address').max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters'),
  inviteCode: z
    .string()
    .min(6)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid invite code format')
    .optional(),
});

export const LoginSchema = z.object({
  username: z.string().min(3).max(100).optional(),
  email: z.string().email().max(100).optional(),
  password: z.string().min(1).max(128),
}).refine((data) => !!(data.username || data.email), {
  message: 'Either username or email is required',
  path: ['username'],
});

// ── Chat Schema ─────────────────────────────────────────────────────────────
export const ChatMessageSchema = z.object({
  message: SanitizedString(200),
  roomId: z.string().min(1).max(100), // Supports both UUID and named rooms like room-park
});

// ── XSS defense-in-depth for display fields ────────────────────────────────
// Chat/guestbook free text may contain "<3" and is neutralised at OUTPUT via
// client-side escaping. Fields re-rendered in styled templates (club names /
// mottos / tags, gallery captions / room names, pet names) reject angle
// brackets and control characters at INPUT so no markup can ever be stored.
const NO_MARKUP_MSG = 'HTML markup (< >) and control characters are not allowed';

export const hasNoMarkup = (v: string): boolean =>
  !/[<>]/.test(v) && !/[\u0000-\u001F\u007F]/.test(v);

export const DisplayString = (max: number, min = 1) =>
  z.string().min(min).max(max).refine(hasNoMarkup, { message: NO_MARKUP_MSG });

export const OptionalDisplayString = (max: number) =>
  z.string().max(max).refine(hasNoMarkup, { message: NO_MARKUP_MSG }).optional();

export const CreateClubSchema = z.object({
  name: DisplayString(24, 3),
  motto: OptionalDisplayString(80),
  tag: OptionalDisplayString(5),
});

export const CreateGalleryPhotoSchema = z.object({
  imageUrl: z.string(), // base64 data URL or storage url (body parser caps size)
  caption: OptionalDisplayString(80),
  roomName: DisplayString(100).default('Haven Park'),
});

// ── Movement Schema ─────────────────────────────────────────────────────────
export const MoveSchema = z.object({
  x: z.number().min(-500).max(500),
  y: z.number().min(-100).max(500),
  z: z.number().min(-500).max(500),
  roomId: z.string().min(1).max(100),
});

// ── Trade Schema ────────────────────────────────────────────────────────────
export const TradeSchema = z.object({
  targetUserId: UUIDField,
  offeredItemIds: UUIDArray,
  requestedItemIds: UUIDArray,
});

// ── Room Join Schema ────────────────────────────────────────────────────────
export const JoinRoomSchema = z.object({
  roomId: z.string().min(1).max(100),
});

// ── Fishing Schema ──────────────────────────────────────────────────────────
export const FishingResultSchema = z.object({
  tensionValue: z.number().min(0).max(1),
  castTime: z.number().int().min(0).max(30000), // ms, max 30 seconds
  sessionKey: z.string().min(1).max(64).optional(),
});
