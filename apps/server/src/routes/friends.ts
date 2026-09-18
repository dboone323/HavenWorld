import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { redis } from '../redis';

const router = Router();

// GET /api/friends — list accepted friends with online status
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const friends = await prisma.friend.findMany({
    where: {
      OR: [{ requesterId: userId }, { addresseeId: userId }],
      status: 'ACCEPTED',
    },
    include: {
      requester: { select: { id: true, username: true } },
      addressee: { select: { id: true, username: true } },
    },
  });

  const result = await Promise.all(
    friends.map(async (f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      const isOnline = await redis.sIsMember('online_users', friend.id);
      return { ...friend, isOnline };
    })
  );

  return res.json(result);
});

// GET /api/friends/requests — pending incoming requests
router.get('/requests', requireAuth, async (req: AuthRequest, res) => {
  const requests = await prisma.friend.findMany({
    where: {
      addresseeId: req.user!.userId,
      status: 'PENDING',
    },
    include: {
      requester: { select: { id: true, username: true } },
    },
  });
  return res.json(requests);
});

// POST /api/friends/request — send a friend request
router.post('/request', requireAuth, async (req: AuthRequest, res) => {
  const { targetUserId } = req.body;
  if (targetUserId === req.user!.userId) {
    return res.status(400).json({ error: 'You cannot send a friend request to yourself.' });
  }

  const existing = await prisma.friend.findFirst({
    where: {
      OR: [
        { requesterId: req.user!.userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: req.user!.userId },
      ],
    },
  });

  if (existing) {
    return res.status(409).json({ error: 'Friend request already exists.' });
  }

  const request = await prisma.friend.create({
    data: {
      requesterId: req.user!.userId,
      addresseeId: targetUserId,
    },
  });

  return res.status(201).json(request);
});

// POST /api/friends/accept/:requesterId — accept a friend request
router.post('/accept/:requesterId', requireAuth, async (req: AuthRequest, res) => {
  const requesterId = req.params.requesterId as string;
  const updated = await prisma.friend.updateMany({
    where: {
      requesterId,
      addresseeId: req.user!.userId,
      status: 'PENDING',
    },
    data: { status: 'ACCEPTED' },
  });

  if (updated.count === 0) {
    return res.status(404).json({ error: 'Friend request not found.' });
  }

  return res.json({ message: 'Friend request accepted.' });
});

// DELETE /api/friends/:friendId — remove a friend or decline a request
router.delete('/:friendId', requireAuth, async (req: AuthRequest, res) => {
  const friendId = req.params.friendId as string;
  await prisma.friend.deleteMany({
    where: {
      id: friendId,
      OR: [{ requesterId: req.user!.userId }, { addresseeId: req.user!.userId }],
    },
  });
  return res.json({ message: 'Friend removed.' });
});

export default router;
