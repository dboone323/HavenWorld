import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../prisma';
import { redis } from '../redis';
import { inventoryService } from '../services/InventoryService';
import { Resend } from 'resend';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder');

// ── Zod validation schemas ───────────────────────────────────────────────────
const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username cannot exceed 20 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function generateTokens(userId: string, username: string, role: string) {
  const accessToken = jwt.sign(
    { userId, username, role },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: (process.env.JWT_ACCESS_EXPIRES as any) ?? '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: (process.env.JWT_REFRESH_EXPIRES as any) ?? '7d' }
  );
  return { accessToken, refreshToken };
}

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  // 1. Validate input
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const { username, email, password, inviteCode } = parsed.data;

  // 2. Check invite code (only when ALPHA_INVITE_ONLY=true)
  let inviteRecord: any = null;
  if (process.env.ALPHA_INVITE_ONLY === 'true') {
    if (!inviteCode) {
      return res.status(403).json({
        error: 'An invite code is required during alpha.',
        code: 'INVITE_REQUIRED',
      });
    }
    inviteRecord = await prisma.inviteCode.findUnique({
      where: { code: inviteCode.toUpperCase() },
    });
    if (
      !inviteRecord ||
      !inviteRecord.isActive ||
      inviteRecord.usedById ||
      new Date() > inviteRecord.expiresAt
    ) {
      return res.status(403).json({
        error: 'Invalid or expired invite code.',
        code: 'INVITE_INVALID',
      });
    }
  }

  // 3. Check username uniqueness (case-insensitive)
  const existingUsername = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
  });
  if (existingUsername) {
    return res.status(409).json({
      error: 'Username already taken.',
      code: 'USERNAME_TAKEN',
    });
  }

  // 4. Check email uniqueness
  const existingEmail = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existingEmail) {
    return res.status(409).json({
      error: 'An account with this email already exists.',
      code: 'EMAIL_TAKEN',
    });
  }

  // 5. Hash password (12 rounds)
  const passwordHash = await bcrypt.hash(password, 12);
  const emailVerifyToken = crypto.randomBytes(32).toString('hex');

  // 6. Create user, avatar, personal room in a transaction
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        username,
        email: email.toLowerCase(),
        passwordHash,
        emailVerifyToken,
      },
    });

    // Create default avatar
    await tx.avatar.create({
      data: {
        userId: newUser.id,
        bodyType: 'default',
        skinTone: 'light',
        hairStyle: 'hair-short-01',
        hairColor: 'brown',
        eyeStyle: 'eyes-default',
        outfitBody: 'shirt-white',
        outfitLegs: 'pants-blue',
        outfitFeet: 'shoes-white',
      },
    });

    // Create personal room
    await tx.room.create({
      data: {
        name: `${username}'s Room`,
        description: 'My personal HavenWorld space.',
        ownerId: newUser.id,
        isPublic: false,
        maxOccupants: 10,
        width: 10,
        height: 8,
        backgroundKey: 'map-personal-room',
        theme: 'personal',
      },
    });

    return newUser;
  });

  // 7. Grant default free items to inventory
  await inventoryService.grantDefaultItems(user.id);

  // 8. Mark invite code as used
  if (inviteRecord) {
    await prisma.inviteCode.update({
      where: { id: inviteRecord.id },
      data: {
        usedById: user.id,
        usedAt: new Date(),
        isActive: false,
      },
    });
  }

  // 9. Send verification email via Resend
  const serverUrl = process.env.SERVER_URL || 'https://147-224-164-228.nip.io';
  const verifyUrl = `${serverUrl}/api/auth/verify?token=${emailVerifyToken}`;

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Verify your HavenWorld account',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d1a;color:#fff;border-radius:16px;">
          <h1 style="color:#4ecdc4;">Welcome to HavenWorld, ${username}!</h1>
          <p>Click the button below to verify your email and enter the world.</p>
          <a href="${verifyUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4ecdc4;color:#0d0d1a;text-decoration:none;border-radius:8px;font-weight:bold;">
            Verify My Account
          </a>
          <p style="color:#aaa;font-size:0.85rem;">
            Link expires in 48 hours. If you didn't create this account, ignore this email.
          </p>
        </div>
      `,
    }).catch((err) => console.error('[Resend] Verification email error:', err));
  }

  return res.status(201).json({
    message: 'Account created! Check your email to verify before logging in.',
  });
});

// ── GET /api/auth/verify ──────────────────────────────────────────────────────
router.get('/verify', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({
      error: 'Verification token is missing.',
      code: 'TOKEN_MISSING',
    });
  }

  const user = await prisma.user.findFirst({
    where: { emailVerifyToken: token },
  });

  if (!user) {
    return res.status(400).json({
      error: 'Invalid or expired verification token.',
      code: 'TOKEN_INVALID',
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
    },
  });

  const clientUrl = process.env.CLIENT_URL || 'https://havenworld-game.pages.dev';
  return res.redirect(`${clientUrl}?verified=true`);
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request.',
      code: 'VALIDATION_ERROR',
    });
  }

  const { email, password } = parsed.data;

  // Find by email — never reveal which field was wrong
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    return res.status(401).json({
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
    });
  }

  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'Please verify your email address before logging in.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }

  if (user.status === 'BANNED') {
    return res.status(403).json({
      error: 'This account has been suspended.',
      code: 'ACCOUNT_BANNED',
    });
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    return res.status(401).json({
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
    });
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.username, user.role);

  // Store refresh token in Redis (7-day TTL)
  await redis.setEx(`refresh:${user.id}`, 7 * 24 * 3600, refreshToken);

  // Update last login timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Set httpOnly refresh token cookie
  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

  return res.json({
    accessToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) {
    return res.status(401).json({
      error: 'No refresh token.',
      code: 'NO_REFRESH_TOKEN',
    });
  }

  let payload: any;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!);
  } catch {
    return res.status(401).json({
      error: 'Refresh token invalid or expired.',
      code: 'REFRESH_INVALID',
    });
  }

  // Check Redis allowlist — prevents reuse after logout
  const stored = await redis.get(`refresh:${payload.userId}`);
  if (stored !== refreshToken) {
    return res.status(401).json({
      error: 'Refresh token has been revoked.',
      code: 'REFRESH_REVOKED',
    });
  }

  // Load current user
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, role: true, status: true },
  });

  if (!user || user.status === 'BANNED') {
    return res.status(403).json({
      error: 'Account not found or suspended.',
      code: 'ACCOUNT_INVALID',
    });
  }

  // Issue new access token + rotate refresh token
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(
    user.id,
    user.username,
    user.role
  );

  await redis.setEx(`refresh:${user.id}`, 7 * 24 * 3600, newRefreshToken);
  res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS);

  return res.json({ accessToken });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.cookies;
  if (refreshToken) {
    try {
      const payload = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET!
      ) as any;
      await redis.del(`refresh:${payload.userId}`);
    } catch {
      // Token already expired — no action needed
    }
  }
  res.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
  return res.json({ message: 'Logged out successfully.' });
});

export default router;
