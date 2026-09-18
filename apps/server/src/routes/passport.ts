import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
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

export default router;
