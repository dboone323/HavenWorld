import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { AchievementService } from '../services/AchievementService';

const router = Router();

// GET /api/passport/:userId — public passport and achievement stamps
router.get('/:userId', requireAuth, async (req, res) => {
  const userId = req.params.userId as string;
  const passport = await AchievementService.getPassportData(userId);

  if (!passport) {
    return res.status(404).json({ error: 'Player passport not found' });
  }

  return res.json(passport);
});

// PUT /api/passport/frame — customize passport frame
router.put('/frame', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { frameId } = req.body;

  if (!frameId || typeof frameId !== 'string') {
    return res.status(400).json({ error: 'frameId is required' });
  }

  try {
    const updated = await AchievementService.setPassportFrame(userId, frameId);
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update passport frame' });
  }
});

// PUT /api/passport/badge — select featured profile badge
router.put('/badge', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { badge } = req.body;

  if (!badge || typeof badge !== 'string') {
    return res.status(400).json({ error: 'badge is required' });
  }

  try {
    const updated = await AchievementService.setFeaturedBadge(userId, badge);
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update featured badge' });
  }
});

export default router;
