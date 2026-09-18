import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { inventoryService } from '../services/InventoryService';

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
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json(user);
});

// GET /api/users/me/avatar — current user avatar config
router.get('/me/avatar', requireAuth, async (req: AuthRequest, res) => {
  const avatar = await prisma.avatar.findUnique({
    where: { userId: req.user!.userId },
  });
  if (!avatar) return res.status(404).json({ error: 'Avatar not found.' });
  return res.json(avatar);
});

// GET /api/users/me/inventory — items in user's inventory with full item details
router.get('/me/inventory', requireAuth, async (req: AuthRequest, res) => {
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
