import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { TutorialService } from '../services/TutorialService';

const router = Router();

// GET /api/tutorial/status — get onboarding step status
router.get('/status', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  try {
    const status = await TutorialService.getTutorialStatus(userId);
    return res.json(status);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to get tutorial status' });
  }
});

// POST /api/tutorial/step — advance onboarding step (1, 2, or 3)
router.post('/step', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { step } = req.body;

  if (typeof step !== 'number') {
    return res.status(400).json({ error: 'step must be a number (1, 2, or 3)' });
  }

  try {
    const result = await TutorialService.advanceStep(userId, step);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to advance tutorial step' });
  }
});

export default router;
