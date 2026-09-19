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
