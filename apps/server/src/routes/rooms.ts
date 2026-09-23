import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { roomManager } from '../services/RoomManager';
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

  await prisma.$transaction([
    prisma.roomFurniture.deleteMany({ where: { roomId } }),
    prisma.roomFurniture.createMany({
      data: activeItems.map((p) => ({
        roomId,
        itemId: p.itemId,
        placedBy: userId,
        x: p.x,
        y: p.y,
        z: p.z,
        rotation: p.rotY,
        scaleX: p.scaleX,
        scaleY: p.scaleY,
        scaleZ: p.scaleZ,
      })),
    }),
  ]);

  const io = getIO();
  if (io) {
    io.to(roomId).emit(SOCKET_EVENTS.ROOM_FURNITURE_UPDATED, { roomId });
  }

  return res.json({ success: true, placedCount: activeItems.length });
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

  return res.json(room);
});

// POST /api/rooms/:id/furniture — place furniture in personal room (Track 3.8 Co-Building)
router.post('/:id/furniture', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const allowed = await canDecorateRoom(req.user!.userId, roomId);
  if (!allowed) {
    return res.status(403).json({
      error: 'You do not have decorator permissions in this room.',
      code: 'NOT_ROOM_DECORATOR',
    });
  }

  const { itemId, x, y, z = 0, rotation = 0, layer = 0 } = req.body;

  // Verify item is in the user's inventory
  const owned = await prisma.inventory.findUnique({
    where: {
      userId_itemId: {
        userId: req.user!.userId,
        itemId,
      },
    },
  });

  if (!owned) {
    return res.status(403).json({
      error: 'You do not own this item.',
      code: 'ITEM_NOT_OWNED',
    });
  }

  const placed = await prisma.roomFurniture.create({
    data: {
      roomId,
      itemId,
      placedBy: req.user!.userId,
      x,
      y,
      z,
      rotation,
      layer,
    },
    include: { item: true },
  });

  // Update RoomManager cached furniture list
  const item = placed.item;
  roomManager.addFurniture(roomId, {
    id: placed.id,
    itemId,
    spriteKey: item.spriteKey,
    x,
    y,
    z,
    rotation,
    layer,
  });

  return res.status(201).json(placed);
});

// DELETE /api/rooms/:id/furniture/:furnitureId — remove furniture
router.delete('/:id/furniture/:furnitureId', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const furnitureId = req.params.furnitureId as string;
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return res.status(404).json({ error: 'Room not found.' });

  const allowed = await canDecorateRoom(req.user!.userId, roomId);
  if (!allowed) {
    return res.status(403).json({
      error: 'You do not have decorator permissions in this room.',
      code: 'NOT_ROOM_DECORATOR',
    });
  }

  await prisma.roomFurniture.delete({
    where: { id: furnitureId },
  });

  roomManager.removeFurniture(roomId, furnitureId);
  return res.json({ message: 'Furniture removed.' });
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

export default router;
