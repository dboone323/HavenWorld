import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ClubService } from '../services/ClubService';
import { prisma } from '../prisma';
import { CreateClubSchema } from '../validation/schemas';

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

// POST /api/clubs — create club (500 HavenCoins)
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = CreateClubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid club details' });

  try {
    const club = await ClubService.createClub(
      req.user!.userId,
      parsed.data.name,
      parsed.data.motto,
      parsed.data.tag
    );
    return res.status(201).json(club);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create club';
    return res.status(400).json({ error: message });
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to join club';
    return res.status(400).json({ error: message });
  }
});

// GET /api/clubs/:id/treasury — get club treasury balance, level, and perks
router.get('/:id/treasury', requireAuth, async (req: AuthRequest, res) => {
  try {
    const treasury = await ClubService.getTreasury(req.params.id as string);
    return res.json(treasury);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch treasury';
    return res.status(400).json({ error: message });
  }
});

// POST /api/clubs/:id/treasury/deposit — deposit HavenCoins to club treasury
router.post('/:id/treasury/deposit', requireAuth, async (req: AuthRequest, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Deposit amount must be a positive number' });
  }

  try {
    const result = await ClubService.depositTreasury(
      req.user!.userId,
      req.params.id as string,
      Math.floor(amount)
    );
    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Treasury deposit failed';
    return res.status(400).json({ error: message });
  }
});

// PATCH /api/clubs/:id/members/:targetUserId/role — promote/demote club member
router.patch('/:id/members/:targetUserId/role', requireAuth, async (req: AuthRequest, res) => {
  const { role } = req.body;
  if (!role || (role !== 'OFFICER' && role !== 'MEMBER')) {
    return res.status(400).json({ error: 'Valid role (OFFICER or MEMBER) is required' });
  }

  try {
    const updated = await ClubService.updateMemberRole(
      req.user!.userId,
      req.params.id as string,
      req.params.targetUserId as string,
      role
    );
    return res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update member role';
    return res.status(400).json({ error: message });
  }
});

// PATCH /api/clubs/:id/motd — update club motd/announcement
router.patch('/:id/motd', requireAuth, async (req: AuthRequest, res) => {
  const { motd } = req.body;
  try {
    const updated = await ClubService.setClubMotd(
      req.user!.userId,
      req.params.id as string,
      String(motd ?? '')
    );
    return res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update club MOTD';
    return res.status(400).json({ error: message });
  }
});

export default router;
