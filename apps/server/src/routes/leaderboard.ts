import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { LeaderboardService } from '../services/LeaderboardService';

const router = Router();

// GET /api/leaderboard?category=RICHEST_PLAYERS | MASTER_CHEFS | MASTER_ANGLERS | TOP_DECORATORS
router.get('/', requireAuth, async (req, res) => {
  const category = (req.query.category as any) || 'RICHEST_PLAYERS';

  try {
    const rankings = await LeaderboardService.getLeaderboard(category);
    return res.json(rankings);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to retrieve leaderboard' });
  }
});

export default router;
