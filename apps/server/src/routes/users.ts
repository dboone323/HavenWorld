import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { inventoryService } from '../services/InventoryService';
import { getIO } from '../sockets';
import { roomManager } from '../services/RoomManager';
import { SOCKET_EVENTS } from '@havenworld/shared';

const router = Router();

// GET /api/users/me — current user profile
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      havenCoins: true,
      havenGems: true,
      isVIP: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({
    ...user,
    coinBalance: user.havenCoins,
  });
});

// POST /api/users/daily-claim — claim daily login reward
router.post('/daily-claim', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const now = new Date();

  // Find or create daily login streak record
  let streak = await prisma.dailyLoginStreak.findUnique({
    where: { userId },
  });

  if (streak) {
    const lastDate = new Date(streak.lastLoginDate);
    const isSameDay =
      lastDate.getFullYear() === now.getFullYear() &&
      lastDate.getMonth() === now.getMonth() &&
      lastDate.getDate() === now.getDate();

    if (isSameDay) {
      return res.json({
        alreadyClaimed: true,
        streak: streak.currentStreak,
        coinsAwarded: 0,
      });
    }

    // Check if streak was missed (more than 48h)
    const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
    const newStreak = diffHours <= 48 ? streak.currentStreak + 1 : 1;
    const coinsAwarded = Math.min(newStreak, 7) * 20;

    streak = await prisma.dailyLoginStreak.update({
      where: { userId },
      data: {
        currentStreak: newStreak,
        longestStreak: Math.max(newStreak, streak.longestStreak),
        lastLoginDate: now,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { havenCoins: { increment: coinsAwarded } },
    });

    return res.json({
      alreadyClaimed: false,
      streak: newStreak,
      coinsAwarded,
    });
  } else {
    const newStreak = 1;
    const coinsAwarded = 20;

    streak = await prisma.dailyLoginStreak.create({
      data: {
        userId,
        currentStreak: newStreak,
        longestStreak: newStreak,
        lastLoginDate: now,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { havenCoins: { increment: coinsAwarded } },
    });

    return res.json({
      alreadyClaimed: false,
      streak: newStreak,
      coinsAwarded,
    });
  }
});

// GET /api/users/me/avatar — current user avatar config
router.get('/me/avatar', requireAuth, async (req: AuthRequest, res) => {
  const avatar = await prisma.avatar.findUnique({
    where: { userId: req.user!.userId },
  });
  if (!avatar) return res.status(404).json({ error: 'Avatar not found.' });
  return res.json({
    ...avatar,
    bodyType: avatar.bodyTypeVal,
    height: avatar.heightVal,
    build: avatar.buildVal,
  });
});

const avatarDataSchema = z.object({
  bodyType: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
  build: z.number().min(0).max(1).optional(),
  skinTone: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  hairColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  eyeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  topColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bottomColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  hairStyle: z.string().optional(),
  eyeStyle: z.string().optional(),
});

// PUT /api/users/me/avatar — save 3D avatar customization
router.put('/me/avatar', requireAuth, async (req: AuthRequest, res) => {
  const parsed = avatarDataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid avatar data', issues: parsed.error.issues });
  }

  const userId = req.user!.userId;
  const d = parsed.data;

  const updated = await prisma.avatar.upsert({
    where: { userId },
    create: {
      userId,
      skinTone: d.skinTone ?? '#F5CBA7',
      hairColor: d.hairColor ?? '#1C1C1C',
      eyeColor: d.eyeColor ?? '#4A3728',
      topColor: d.topColor ?? '#4169E1',
      bottomColor: d.bottomColor ?? '#2E8B57',
      bodyTypeVal: d.bodyType ?? 0.5,
      heightVal: d.height ?? 0.5,
      buildVal: d.build ?? 0.5,
      hairStyle: d.hairStyle ?? 'hair-short-01',
      eyeStyle: d.eyeStyle ?? 'eyes-default',
    },
    update: {
      skinTone: d.skinTone,
      hairColor: d.hairColor,
      eyeColor: d.eyeColor,
      topColor: d.topColor,
      bottomColor: d.bottomColor,
      bodyTypeVal: d.bodyType,
      heightVal: d.height,
      buildVal: d.build,
      hairStyle: d.hairStyle,
      eyeStyle: d.eyeStyle,
    },
  });

  const io = getIO();
  if (io) {
    const currentRoom = roomManager.getPlayerRoom(userId) || (req.body as any).roomId;
    if (currentRoom) {
      io.to(currentRoom).emit(SOCKET_EVENTS.AVATAR_UPDATE, {
        userId,
        avatarData: d,
      });
    }
  }

  return res.json({ success: true, avatar: updated });
});

// GET /api/users/me/inventory — items in user's inventory with full item details
router.get('/me/inventory', requireAuth, async (req: AuthRequest, res) => {
  const typeFilter = req.query.type as string | undefined;
  if (typeFilter === 'furniture') {
    const furniture = await prisma.inventory.findMany({
      where: {
        userId: req.user!.userId,
        item: { category: 'FURNITURE' },
      },
      include: { item: true },
    });
    return res.json(
      furniture.map((f) => ({
        itemId: f.item.id,
        name: f.item.name,
        assetUrl: f.item.assetUrl || `/assets/furniture/${f.item.spriteKey}.glb`,
        quantity: f.quantity,
      }))
    );
  }

  const inventory = await inventoryService.getUserInventory(req.user!.userId);
  return res.json(inventory);
});

// GET /api/users/me/room — user's personal room ID
router.get('/me/room', requireAuth, async (req: AuthRequest, res) => {
  const room = await prisma.room.findFirst({
    where: { ownerId: req.user!.userId },
    select: { id: true, name: true, width: true, height: true },
  });
  if (!room) return res.status(404).json({ error: 'Personal room not found.' });
  return res.json(room);
});

// GET /api/users/:username — public profile of another user
router.get('/:username', requireAuth, async (req: AuthRequest, res) => {
  const username = req.params.username as string;
  const user = await prisma.user.findFirst({
    where: {
      username: { equals: username, mode: 'insensitive' },
    },
    select: { id: true, username: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json(user);
});

export default router;
