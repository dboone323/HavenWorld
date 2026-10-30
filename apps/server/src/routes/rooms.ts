import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { roomManager } from '../services/RoomManager';
import { LoftRatingService } from '../services/LoftRatingService';
import { inventoryService } from '../services/InventoryService';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

const router = Router();

// GET /api/rooms — list public rooms or community lofts with live occupant counts
router.get('/', requireAuth, async (req, res) => {
  const isLofts = req.query.type === 'lofts';

  const rooms = await prisma.room.findMany({
    where: isLofts
      ? { backgroundKey: 'map-personal-room' }
      : { isPublic: true },
    select: {
      id: true,
      name: true,
      description: true,
      maxOccupants: true,
      theme: true,
      backgroundKey: true,
      ownerId: true,
    },
    orderBy: { name: 'asc' },
    take: isLofts ? 50 : 10,
  });

  // Inject live player count from RoomManager in-memory state
  const withOccupants = rooms.map((room) => ({
    ...room,
    occupants: roomManager.getOccupantCount(room.id),
  }));

  return res.json(withOccupants);
});

// GET /api/rooms/:id/furniture — list furniture in 3D format
router.get('/:id/furniture', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const roomId = req.params.id as string;
  const dbFurniture = await prisma.roomFurniture.findMany({
    where: { roomId },
    include: { item: true },
  });

  const formatted = dbFurniture.map((f) => ({
    id: f.id,
    itemId: f.itemId,
    assetUrl: f.item.assetUrl || `/assets/furniture/${f.item.spriteKey}.glb`,
    placedById: f.placedBy,
    x: f.x,
    y: f.y,
    z: f.z,
    rotY: f.rotation,
    scaleX: f.scaleX ?? 1,
    scaleY: f.scaleY ?? 1,
    scaleZ: f.scaleZ ?? 1,
  }));

  return res.json(formatted);
});

const furniturePlacementSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  assetUrl: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  rotY: z.number(),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  scaleZ: z.number().default(1),
  isNew: z.boolean().optional(),
  isRemoved: z.boolean().optional(),
});

const layoutBodySchema = z.object({
  layout: z.array(furniturePlacementSchema),
});

async function canDecorateRoom(userId: string, roomId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { decorators: true },
  });
  if (!room) return false;
  if (room.ownerId === userId) return true;
  return room.decorators.some((d) => d.userId === userId);
}

const STARTER_FURNITURE_ITEM_IDS = new Set([
  'furniture-chair',
  'furniture-table',
  'furniture-plant',
  'furniture-rug',
  'furniture-lamp',
]);

// POST /api/rooms/:id/furniture/layout — atomic layout replace (Part 5B & Track 3.8 Co-Building)
router.post('/:id/furniture/layout', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const userId = req.user!.userId;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const allowed = await canDecorateRoom(userId, roomId);
  if (!allowed) {
    return res.status(403).json({ error: 'You do not have decorator permissions in this room.' });
  }

  const parsed = layoutBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid layout data', issues: parsed.error.issues });
  }

  const { layout } = parsed.data;
  const activeItems = layout.filter((p) => !p.isRemoved);

  // Fetch currently placed furniture in this room
  const currentFurniture = await prisma.roomFurniture.findMany({
    where: { roomId },
  });
  const currentById = new Map(currentFurniture.map((f) => [f.id, f]));

  // Count current placed items by user: Map<itemId, number>
  // In a personal room / owner-managed room, all existing placed furniture belongs to the room owner
  const currentCounts = new Map<string, number>();
  const isOwner = room.ownerId === userId;
  for (const item of currentFurniture) {
    if (item.placedBy === userId || isOwner) {
      currentCounts.set(item.itemId, (currentCounts.get(item.itemId) || 0) + 1);
    }
  }

  // Count target new placements by user
  const newCounts = new Map<string, number>();
  for (const item of activeItems) {
    newCounts.set(item.itemId, (newCounts.get(item.itemId) || 0) + 1);
  }

  // Calculate net deltas (positive = requires inventory deduction; negative = return to inventory)
  const allItemIds = new Set([...currentCounts.keys(), ...newCounts.keys()]);
  const inventoryDeltas = new Map<string, number>();
  for (const itemId of allItemIds) {
    const prev = currentCounts.get(itemId) || 0;
    const next = newCounts.get(itemId) || 0;
    const delta = next - prev;
    if (delta !== 0) {
      inventoryDeltas.set(itemId, delta);
    }
  }

  // Verify inventory for any net additions (delta > 0)
  const additions = [...inventoryDeltas.entries()].filter(([, d]) => d > 0);
  if (additions.length > 0) {
    const neededItemIds = additions.map(([itemId]) => itemId);
    const userInventory = await prisma.inventory.findMany({
      where: {
        userId,
        itemId: { in: neededItemIds },
      },
    });
    const invMap = new Map(userInventory.map((i) => [i.itemId, i.quantity]));
    const missing: string[] = [];

    for (const [itemId, needed] of additions) {
      const available = invMap.get(itemId) || 0;
      if (available < needed) {
        // Room owners are granted 1 free placement allowance for starter furniture pieces
        if (isOwner && STARTER_FURNITURE_ITEM_IDS.has(itemId) && available + 1 >= needed) {
          continue;
        }
        missing.push(itemId);
      }
    }

    if (missing.length > 0) {
      return res.status(403).json({
        error: 'You do not own all placed furniture items in your inventory.',
        code: 'ITEM_NOT_OWNED',
        missingItemIds: missing,
      });
    }
  }

  // Atomically apply inventory adjustments and update room furniture
  await prisma.$transaction(async (tx) => {
    for (const [itemId, delta] of inventoryDeltas.entries()) {
      if (delta > 0) {
        const inv = await tx.inventory.findUnique({
          where: { userId_itemId: { userId, itemId } },
        });
        if (!inv || inv.quantity < delta) {
          if (isOwner && STARTER_FURNITURE_ITEM_IDS.has(itemId) && (!inv || inv.quantity + 1 >= delta)) {
            if (inv) {
              await tx.inventory.delete({ where: { id: inv.id } });
            }
          } else {
            throw new Error(`INSUFFICIENT_INVENTORY: Missing ${itemId}`);
          }
        } else if (inv.quantity === delta) {
          await tx.inventory.delete({ where: { id: inv.id } });
        } else {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { decrement: delta } },
          });
        }
      } else if (delta < 0) {
        const returnCount = Math.abs(delta);
        const inv = await tx.inventory.findUnique({
          where: { userId_itemId: { userId, itemId } },
        });
        if (inv) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { increment: returnCount } },
          });
        } else {
          await tx.inventory.create({
            data: { userId, itemId, quantity: returnCount },
          });
        }
      }
    }

    await tx.roomFurniture.deleteMany({ where: { roomId } });
    if (activeItems.length > 0) {
      await tx.roomFurniture.createMany({
        data: activeItems.map((p) => {
          const existing = p.id ? currentById.get(p.id) : undefined;
          const placedBy = existing ? existing.placedBy : userId;
          return {
            roomId,
            itemId: p.itemId,
            placedBy,
            x: p.x,
            y: p.y,
            z: p.z,
            rotation: p.rotY,
            scaleX: p.scaleX,
            scaleY: p.scaleY,
            scaleZ: p.scaleZ,
          };
        }),
      });
    }
  });

  const refreshed = await prisma.roomFurniture.findMany({
    where: { roomId },
    include: { item: true },
    orderBy: { layer: 'asc' },
  });
  roomManager.setFurniture(
    roomId,
    refreshed.map((f) => ({
      id: f.id,
      itemId: f.itemId,
      spriteKey: f.item.spriteKey,
      x: f.x,
      y: f.y,
      z: f.z,
      rotation: f.rotation,
      layer: f.layer,
      type: f.item.spriteKey,
      depth: f.y,
      ownerId: f.placedBy,
    }))
  );

  const io = getIO();
  if (io) {
    io.to(roomId).emit(SOCKET_EVENTS.ROOM_FURNITURE_UPDATED, { roomId });
  }

  return res.json({ success: true, placedCount: activeItems.length });
});

// PUT /api/rooms/:id/surfaces — update floor and wall customization
const surfaceBodySchema = z.object({
  floorTexture: z.string().min(1).max(128).optional(),
  wallTexture: z.string().min(1).max(128).optional(),
});

router.put('/:id/surfaces', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const userId = req.user!.userId;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const allowed = await canDecorateRoom(userId, roomId);
  if (!allowed) {
    return res.status(403).json({ error: 'You do not have decorator permissions in this room.' });
  }

  const parsed = surfaceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid surface parameters', issues: parsed.error.issues });
  }

  const updated = await prisma.room.update({
    where: { id: roomId },
    data: {
      ...(parsed.data.floorTexture ? { floorTexture: parsed.data.floorTexture } : {}),
      ...(parsed.data.wallTexture ? { wallTexture: parsed.data.wallTexture } : {}),
    },
    select: { id: true, floorTexture: true, wallTexture: true },
  });

  const io = getIO();
  if (io) {
    io.to(roomId).emit('room:surfaces_updated', {
      roomId,
      floorTexture: updated.floorTexture,
      wallTexture: updated.wallTexture,
    });
  }

  return res.json({ success: true, surfaces: updated });
});

// ── Phase 3B: Trending Lofts & Upvotes (community ratings) ────────────────
// NOTE: must stay registered above the '/:id' param route so "trending" and "showcase" aren't
// swallowed as a roomId.
router.get('/trending', requireAuth, async (req, res) => {
  const raw = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 25) : 10;

  const trending = await LoftRatingService.getTrendingLofts(limit);
  res.json(trending);
});

router.get('/showcase/leaderboard', requireAuth, async (req, res) => {
  const weekKey = typeof req.query.week === 'string' ? req.query.week : undefined;
  const raw = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 25) : 10;

  const leaderboard = await LoftRatingService.getWeeklyLeaderboard(weekKey, limit);
  res.json(leaderboard);
});

router.post('/:id/upvote', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  try {
    const result = await LoftRatingService.upvoteRoom(req.user!.userId, roomId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upvote loft';
    res.status(400).json({ error: message });
  }
});

router.post('/:id/rate', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const { stars, tags, comment } = req.body || {};
  try {
    const result = await LoftRatingService.submitLoftRating(req.user!.userId, roomId, {
      stars: Number(stars),
      tags,
      comment,
    });
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to rate loft';
    res.status(400).json({ error: message });
  }
});

router.get('/:id/rating-summary', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  try {
    const summary = await LoftRatingService.getRoomRatingSummary(roomId);
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch rating summary';
    res.status(400).json({ error: message });
  }
});

// GET /api/rooms/:id — single room details including furniture
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      furniture: {
        include: { item: true },
        orderBy: { layer: 'asc' },
      },
      decorators: {
        include: { user: { select: { id: true, username: true } } },
      },
    },
  });

  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const { passwordHash, ...safeRoom } = room;
  return res.json({
    ...safeRoom,
    hasPassword: Boolean(passwordHash),
  });
});

const placeFurnitureBodySchema = z.object({
  itemId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite().optional(),
  rotation: z.number().finite().optional(),
  layer: z.union([z.string(), z.number().int()]).optional(),
});

// POST /api/rooms/:id/furniture — place furniture in personal room (Track 3.8 Co-Building)
router.post('/:id/furniture', requireAuth, async (req: AuthRequest, res) => {
  const parsed = placeFurnitureBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid furniture placement payload',
      issues: parsed.error.issues,
    });
  }

  const roomId = req.params.id as string;
  const { itemId, x, y, z = 0, rotation = 0, layer: rawLayer } = parsed.data;
  const layer =
    typeof rawLayer === 'number'
      ? rawLayer
      : rawLayer !== undefined
        ? Number.parseInt(rawLayer, 10) || 0
        : 0;

  try {
    const placed = await inventoryService.placeFurnitureItem(req.user!.userId, roomId, {
      itemId,
      x,
      y,
      z,
      rotation,
      layer,
    });

    // Update RoomManager cached furniture list
    roomManager.addFurniture(roomId, {
      id: placed.id,
      itemId,
      spriteKey: placed.item.spriteKey,
      x,
      y,
      z,
      rotation,
      layer,
    });

    return res.status(201).json(placed);
  } catch (err: any) {
    if (err?.message === 'ROOM_NOT_FOUND') {
      return res.status(404).json({ error: 'Room not found.' });
    }
    if (err?.message === 'NOT_ROOM_DECORATOR') {
      return res.status(403).json({
        error: 'You do not have decorator permissions in this room.',
        code: 'NOT_ROOM_DECORATOR',
      });
    }
    if (err?.message === 'ITEM_NOT_OWNED') {
      return res.status(403).json({
        error: 'You do not own this item in sufficient quantity.',
        code: 'ITEM_NOT_OWNED',
      });
    }
    return res.status(500).json({ error: err?.message || 'Failed to place furniture' });
  }
});

// DELETE /api/rooms/:id/furniture/:furnitureId — remove furniture
router.delete('/:id/furniture/:furnitureId', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const furnitureId = req.params.furnitureId as string;

  try {
    const removed = await inventoryService.pickupFurnitureItem(
      req.user!.userId,
      roomId,
      furnitureId
    );

    roomManager.removeFurniture(roomId, furnitureId);
    return res.json({ message: 'Furniture removed.', item: removed });
  } catch (err: any) {
    if (err?.message === 'FURNITURE_NOT_FOUND') {
      return res.status(404).json({ error: 'Furniture item not found.' });
    }
    if (err?.message === 'NOT_ROOM_DECORATOR') {
      return res.status(403).json({
        error: 'You do not have decorator permissions in this room.',
        code: 'NOT_ROOM_DECORATOR',
      });
    }
    return res.status(500).json({ error: err?.message || 'Failed to remove furniture' });
  }
});

// ── Track 3.5: Room Expansions ──────────────────────────────────────────────
const expandSchema = z.object({
  width: z.number().int().min(10).max(30),
  height: z.number().int().min(10).max(30),
});

router.post('/:id/expand', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const userId = req.user!.userId;
  const parsed = expandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid dimensions', issues: parsed.error.issues });
  }
  const { width, height } = parsed.data;

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.ownerId !== userId) {
    return res.status(403).json({ error: 'You do not own this room.' });
  }
  if (width <= room.width && height <= room.height) {
    return res.status(400).json({ error: 'Expanded dimensions must exceed current dimensions.' });
  }

  const deltaW = Math.max(0, width - room.width);
  const deltaH = Math.max(0, height - room.height);
  const cost = (deltaW + deltaH) * 25; // 25 coins per expanded tile dimension

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.havenCoins < cost) {
    return res.status(400).json({
      error: 'Insufficient HavenCoins',
      required: cost,
      current: user?.havenCoins ?? 0,
    });
  }

  const [updatedUser, updatedRoom] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { havenCoins: { decrement: cost } },
      select: { havenCoins: true },
    }),
    prisma.room.update({
      where: { id: roomId },
      data: { width, height },
    }),
  ]);

  const io = getIO();
  if (io) {
    io.to(roomId).emit(SOCKET_EVENTS.ROOM_EXPANDED, {
      roomId,
      width: updatedRoom.width,
      height: updatedRoom.height,
    });
  }

  return res.json({
    success: true,
    width: updatedRoom.width,
    height: updatedRoom.height,
    coinsSpent: cost,
    newBalance: updatedUser.havenCoins,
  });
});

// ── Track 3.6: Door Linking / Teleporters ──────────────────────────────────
router.post('/:id/teleport', requireAuth, async (req: AuthRequest, res) => {
  const { PrivacyManager } = await import('../services/PrivacyManager');
  const targetRoomId = req.body.targetRoomId as string;
  const password = req.body.password as string | undefined;
  if (!targetRoomId) return res.status(400).json({ error: 'targetRoomId required' });

  const access = await PrivacyManager.checkAccess(req.user!.userId, targetRoomId, password);
  if (!access.allowed) {
    return res.status(403).json({
      error: 'Cannot teleport to target room',
      reason: access.reason,
      awayMessage: access.awayMessage,
    });
  }

  return res.json({
    allowed: true,
    targetRoomId,
    mode: access.mode,
  });
});

// ── Track 3.10: Ambient Room Settings ──────────────────────────────────────
router.put('/:id/ambient', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const userId = req.user!.userId;
  const { moodPreset, theme } = req.body;

  const allowed = await canDecorateRoom(userId, roomId);
  if (!allowed) {
    return res.status(403).json({ error: 'Unauthorized to configure ambient settings' });
  }

  const updated = await prisma.room.update({
    where: { id: roomId },
    data: {
      moodPreset: moodPreset || 'day',
      theme: theme || undefined,
    },
  });

  const io = getIO();
  if (io) {
    io.to(roomId).emit(SOCKET_EVENTS.ROOM_MOOD_CHANGED, {
      roomId,
      mood: updated.moodPreset,
      theme: updated.theme,
    });
  }

  return res.json({ success: true, moodPreset: updated.moodPreset, theme: updated.theme });
});

// ── Track 3.8: Co-Building Rights Management ──────────────────────────────
router.get('/:id/decorators', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const decorators = await prisma.roomDecorator.findMany({
    where: { roomId },
    include: { user: { select: { id: true, username: true } } },
  });
  return res.json(decorators);
});

router.post('/:id/decorators', requireAuth, async (req: AuthRequest, res) => {
  const { PrivacyManager } = await import('../services/PrivacyManager');
  const roomId = req.params.id as string;
  const targetUserId = req.body.targetUserId as string;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

  try {
    const decorator = await PrivacyManager.grantDecorator(req.user!.userId, roomId, targetUserId);
    return res.status(201).json(decorator);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/decorators/:targetUserId', requireAuth, async (req: AuthRequest, res) => {
  const { PrivacyManager } = await import('../services/PrivacyManager');
  const roomId = req.params.id as string;
  const targetUserId = req.params.targetUserId as string;

  try {
    await PrivacyManager.revokeDecorator(req.user!.userId, roomId, targetUserId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/rooms/:id/role — get authenticated user's RBAC role for the loft (OWNER, CO_BUILDER, or VISITOR)
router.get('/:id/role', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const userId = req.user!.userId;
  const { PrivacyManager } = await import('../services/PrivacyManager');
  const role = await PrivacyManager.getLoftRole(userId, roomId);
  return res.json({ roomId, userId, role });
});

export default router;
