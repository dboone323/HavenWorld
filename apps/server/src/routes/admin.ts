import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

// All admin routes require authentication + ADMIN or MODERATOR role
router.use(requireAuth);
router.use(requireRole(['ADMIN', 'MODERATOR']));

// ── INVITE CODE MANAGEMENT (ADMIN only) ──────────────────────────────────────
const generateInviteSchema = z.object({
  count: z.number().int().min(1).max(100).default(25),
  expiryDays: z.number().int().min(1).max(365).default(30),
});

// POST /api/admin/invites/generate — create a batch of invite codes
router.post('/invites/generate', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  const parsed = generateInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid input.',
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const { count, expiryDays } = parsed.data;
  const expiresAt = new Date(Date.now() + expiryDays * 86400000);
  const codes = Array.from({ length: count }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );

  await prisma.inviteCode.createMany({
    data: codes.map((code) => ({
      code,
      createdBy: req.user!.userId,
      expiresAt,
      isActive: true,
    })),
    skipDuplicates: true,
  });

  return res.status(201).json({
    message: `Generated ${codes.length} invite codes expiring in ${expiryDays} days.`,
    codes,
    expiresAt,
  });
});

// GET /api/admin/invites — list all invite codes with usage status
router.get('/invites', requireRole(['ADMIN']), async (_req, res) => {
  const invites = await prisma.inviteCode.findMany({
    include: {
      usedBy: {
        select: { username: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(invites);
});

// DELETE /api/admin/invites/:id — deactivate an unused invite code
router.delete('/invites/:id', requireRole(['ADMIN']), async (req, res) => {
  const id = req.params.id as string;
  await prisma.inviteCode.update({
    where: { id },
    data: { isActive: false },
  });
  return res.json({ message: 'Invite code deactivated.' });
});

// ── USER MANAGEMENT ─────────────────────────────────────────────────────────
// GET /api/admin/users — paginated user list with optional search
router.get('/users', async (req, res) => {
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const limit = parseInt((req.query.limit as string) ?? '50', 10);
  const search = req.query.search as string | undefined;

  const where = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
        mutedUntil: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return res.json({
    users,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

// GET /api/admin/users/:id — single user detail with inventory count
router.get('/users/:id', async (req, res) => {
  const id = req.params.id as string;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      avatar: true,
      _count: {
        select: {
          inventory: true,
          sentMessages: true,
          sentReports: true,
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json(user);
});

const muteSchema = z.object({
  hours: z.number().int().min(1).max(720).default(24),
  reason: z.string().max(200).optional(),
});

// POST /api/admin/users/:id/mute — mute a player for N hours
router.post('/users/:id/mute', async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const parsed = muteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid mute data.' });
  }

  const mutedUntil = new Date(Date.now() + parsed.data.hours * 3600000);
  await prisma.user.update({
    where: { id },
    data: { status: 'MUTED', mutedUntil },
  });

  console.log(`[Admin] ${req.user!.username} muted user ${id} for ${parsed.data.hours}h`);
  return res.json({
    message: `User muted for ${parsed.data.hours} hours.`,
    mutedUntil,
  });
});

// POST /api/admin/users/:id/ban — permanently ban a player
router.post('/users/:id/ban', async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  await prisma.user.update({
    where: { id },
    data: { status: 'BANNED', mutedUntil: null },
  });

  console.log(`[Admin] ${req.user!.username} banned user ${id}`);
  return res.json({ message: 'User has been banned.' });
});

// POST /api/admin/users/:id/unban — restore a muted or banned player
router.post('/users/:id/unban', async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  await prisma.user.update({
    where: { id },
    data: { status: 'ACTIVE', mutedUntil: null },
  });

  console.log(`[Admin] ${req.user!.username} restored user ${id}`);
  return res.json({ message: 'User account restored to active.' });
});

// POST /api/admin/users/:id/promote — promote a player to MODERATOR (ADMIN only)
router.post('/users/:id/promote', requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  await prisma.user.update({
    where: { id },
    data: { role: 'MODERATOR' },
  });
  return res.json({ message: 'User promoted to Moderator.' });
});

// ── REPORT MANAGEMENT ───────────────────────────────────────────────────────
// GET /api/admin/reports — list reports with optional status filter
router.get('/reports', async (req, res) => {
  const status = req.query.status as string | undefined;
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const limit = 25;
  const where = status ? { status: status as any } : { status: 'OPEN' as any };

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      include: {
        reporter: { select: { id: true, username: true } },
        reportedUser: { select: { id: true, username: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.report.count({ where }),
  ]);

  return res.json({
    reports,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

// PATCH /api/admin/reports/:id — update report status and add moderator notes
router.patch('/reports/:id', async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const { status, moderatorNotes } = req.body;
  const validStatuses = ['OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const updated = await prisma.report.update({
    where: { id },
    data: {
      status,
      moderatorNotes: moderatorNotes ?? undefined,
      resolvedAt: ['RESOLVED', 'DISMISSED'].includes(status) ? new Date() : undefined,
    },
  });
  return res.json(updated);
});

// ── CHAT LOG ────────────────────────────────────────────────────────────────
// GET /api/admin/chat-log — paginated chat history for moderation review
router.get('/chat-log', async (req, res) => {
  const roomId = req.query.roomId as string | undefined;
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const limit = 100;

  const messages = await prisma.chatMessage.findMany({
    where: roomId ? { roomId } : {},
    include: {
      sender: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  return res.json(messages);
});

// ── SERVER STATS ────────────────────────────────────────────────────────────
// GET /api/admin/stats — high-level alpha metrics (ADMIN only)
router.get('/stats', requireRole(['ADMIN']), async (_req, res) => {
  const [
    totalUsers,
    verifiedUsers,
    activeUsers,
    openReports,
    totalMessages,
    invitesUsed,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { emailVerified: true } }),
    prisma.user.count({
      where: {
        lastLoginAt: { gte: new Date(Date.now() - 7 * 86400000) },
      },
    }),
    prisma.report.count({ where: { status: 'OPEN' } }),
    prisma.chatMessage.count(),
    prisma.inviteCode.count({
      where: { isActive: false, usedById: { not: null } },
    }),
  ]);

  return res.json({
    users: {
      total: totalUsers,
      verified: verifiedUsers,
      activeThisWeek: activeUsers,
    },
    moderation: { openReports },
    activity: { totalChatMessages: totalMessages },
    alpha: { inviteCodesUsed: invitesUsed },
  });
});

export default router;
