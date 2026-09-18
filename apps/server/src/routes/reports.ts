import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { z } from 'zod';

const router = Router();

const reportSchema = z.object({
  reportedUserId: z.string().uuid(),
  reason: z.enum([
    'HARASSMENT',
    'SPAM',
    'INAPPROPRIATE_CONTENT',
    'IMPERSONATION',
    'CHEATING',
    'OTHER',
  ]),
  description: z.string().max(500).default(''),
});

// POST /api/reports — submit a player report
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid report data.',
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  if (parsed.data.reportedUserId === req.user!.userId) {
    return res.status(400).json({ error: 'You cannot report yourself.' });
  }

  const report = await prisma.report.create({
    data: {
      reporterId: req.user!.userId,
      ...parsed.data,
    },
  });

  return res.status(201).json({
    reportId: report.id,
    message: 'Report submitted. Thank you.',
  });
});

export default router;
