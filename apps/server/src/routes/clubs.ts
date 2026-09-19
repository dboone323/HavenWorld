import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ClubService } from '../services/ClubService';
import { prisma } from '../prisma';
import { z } from 'zod';

const router = Router();

// GET /api/clubs/me — get user's current club info
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const member = await prisma.clubMember.findUnique({
    where: { userId: req.user!.userId },
    include: {
      club: {
        include: {
          members: {
            include: { user: { select: { id: true, username: true, lastLoginAt: true } } },
          },
        },
      },
    },
  });

  if (!member) return res.json(null);
  return res.json(member.club);
});

// GET /api/clubs — list clubs
router.get('/', requireAuth, async (_req, res) => {
  const clubs = await prisma.club.findMany({
    take: 20,
    include: {
      _count: { select: { members: true } },
      owner: { select: { username: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatted = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    motto: c.motto,
    tag: c.tag,
    ownerName: c.owner.username,
    memberCount: c._count.members,
    createdAt: c.createdAt.toISOString(),
  }));

  return res.json(formatted);
});

const createClubSchema = z.object({
  name: z.string().min(3).max(24),
  motto: z.string().max(80).optional(),
  tag: z.string().max(5).optional(),
});

// POST /api/clubs — create club (500 HavenCoins)
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = createClubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid club details' });

  try {
    const club = await ClubService.createClub(
      req.user!.userId,
      parsed.data.name,
      parsed.data.motto,
      parsed.data.tag
    );
    return res.status(201).json(club);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to create club' });
  }
});

// POST /api/clubs/:id/join — join an existing open club
router.post('/:id/join', requireAuth, async (req: AuthRequest, res) => {
  const clubId = req.params.id as string;
  const userId = req.user!.userId;

  try {
    const existing = await prisma.clubMember.findUnique({ where: { userId } });
    if (existing) return res.status(400).json({ error: 'You are already a member of a club' });

    const memberCount = await prisma.clubMember.count({ where: { clubId } });
    if (memberCount >= 50) return res.status(400).json({ error: 'Club is full (max 50 members)' });

    const member = await prisma.clubMember.create({
      data: {
        clubId,
        userId,
        role: 'MEMBER',
      },
    });
    return res.status(201).json(member);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to join club' });
  }
});

export default router;
