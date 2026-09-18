import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { QuestService } from '../services/QuestService';

const router = Router();

// GET /api/quests — return user's active daily quests for today
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const quests = await QuestService.getUserDailyQuests(req.user!.userId);
    return res.json(quests);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load daily quests' });
  }
});

export default router;
