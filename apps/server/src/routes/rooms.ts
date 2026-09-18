import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { roomManager } from '../services/RoomManager';

const router = Router();

// GET /api/rooms — list all public rooms with live occupant counts
router.get('/', requireAuth, async (_req, res) => {
  const rooms = await prisma.room.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      description: true,
      maxOccupants: true,
      theme: true,
    },
    orderBy: { name: 'asc' },
  });

  // Inject live player count from RoomManager in-memory state
  const withOccupants = rooms.map((room) => ({
    ...room,
    occupants: roomManager.getOccupantCount(room.id),
  }));

  return res.json(withOccupants);
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
    },
  });

  if (!room) return res.status(404).json({ error: 'Room not found.' });

  // Private rooms can only be seen by their owner
  if (!room.isPublic && room.ownerId !== req.user!.userId) {
    return res.status(403).json({ error: 'This room is private.', code: 'ROOM_PRIVATE' });
  }

  return res.json(room);
});

// POST /api/rooms/:id/furniture — place furniture in personal room
router.post('/:id/furniture', requireAuth, async (req: AuthRequest, res) => {
  const roomId = req.params.id as string;
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.ownerId !== req.user!.userId) {
    return res.status(403).json({
      error: 'You do not own this room.',
      code: 'NOT_ROOM_OWNER',
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
  if (!room || room.ownerId !== req.user!.userId) {
    return res.status(403).json({
      error: 'You do not own this room.',
      code: 'NOT_ROOM_OWNER',
    });
  }

  await prisma.roomFurniture.delete({
    where: { id: furnitureId },
  });

  roomManager.removeFurniture(roomId, furnitureId);
  return res.json({ message: 'Furniture removed.' });
});

export default router;
