import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { inventoryService } from '../services/InventoryService';
import { getIO } from '../sockets';
import { roomManager } from '../services/RoomManager';
import { SOCKET_EVENTS, OUTFIT_SLOTS, normalizeGender } from '@havenworld/shared';

const router = Router();

// GET /api/users/me — current user profile
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: {
      avatar: true,
      ownedRooms: {
        where: { backgroundKey: 'map-personal-room' },
        take: 1,
      },
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const personalRoom =
    user.ownedRooms?.[0] ??
    (await prisma.room.findFirst({
      where: { ownerId: user.id },
    }));

  return res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    havenCoins: user.havenCoins,
    havenGems: user.havenGems,
    isVIP: user.isVIP,
    avatar: user.avatar,
    coinBalance: user.havenCoins,
    personalRoom: personalRoom ? { id: personalRoom.id, name: personalRoom.name } : null,
  });
});

// GET /api/users/gifts — Track 5.10 Offline Postcards & Mail
router.get('/gifts', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const gifts = await prisma.giftTransaction.findMany({
    where: { receiverId: userId },
    include: {
      sender: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return res.json(gifts);
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
  gender: z.string().optional(),
  // Equipped wardrobe item ids (validated against inventory by the socket handler
  // and by the explicit inventory check below before they are persisted).
  outfitHead: z.string().nullable().optional(),
  outfitFace: z.string().nullable().optional(),
  outfitBody: z.string().nullable().optional(),
  outfitLegs: z.string().nullable().optional(),
  outfitFeet: z.string().nullable().optional(),
  outfitBack: z.string().nullable().optional(),
  outfitHand: z.string().nullable().optional(),
});

// PUT /api/users/me/avatar — save 3D avatar customization
router.put('/me/avatar', requireAuth, async (req: AuthRequest, res) => {
  const parsed = avatarDataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid avatar data', issues: parsed.error.issues });
  }

  const userId = req.user!.userId;
  const d = parsed.data;

  // Wardrobe slots may only reference items the player actually owns.
  const requestedOutfitIds = OUTFIT_SLOTS.map((slot) => d[slot]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  if (new Set(requestedOutfitIds).size > 0) {
    const ownedCount = await prisma.inventory.count({
      where: { userId, itemId: { in: [...new Set(requestedOutfitIds)] } },
    });
    if (ownedCount !== new Set(requestedOutfitIds).size) {
      return res
        .status(403)
        .json({ error: 'One or more wardrobe items are not in your inventory.' });
    }
  }

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
      gender: normalizeGender(d.gender),
      outfitHead: d.outfitHead ?? null,
      outfitFace: d.outfitFace ?? null,
      outfitBody: d.outfitBody ?? null,
      outfitLegs: d.outfitLegs ?? null,
      outfitFeet: d.outfitFeet ?? null,
      outfitBack: d.outfitBack ?? null,
      outfitHand: d.outfitHand ?? null,
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
      gender: d.gender ? normalizeGender(d.gender) : undefined,
      outfitHead: d.outfitHead,
      outfitFace: d.outfitFace,
      outfitBody: d.outfitBody,
      outfitLegs: d.outfitLegs,
      outfitFeet: d.outfitFeet,
      outfitBack: d.outfitBack,
      outfitHand: d.outfitHand,
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
  return res.json(
    inventory.map((entry) => ({
      itemId: entry.itemId,
      name: entry.item.name,
      category: entry.item.category,
      rarity: entry.item.rarity,
      spriteKey: entry.item.spriteKey,
      assetUrl: entry.item.assetUrl,
      quantity: entry.quantity,
      isEquipped: entry.isEquipped,
    }))
  );
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
