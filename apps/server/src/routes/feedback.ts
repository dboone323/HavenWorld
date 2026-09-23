import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { FeedbackService } from '../services/FeedbackService';

const router = Router();

// POST /api/feedback — submit bug or feature feedback
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { type, title, message } = req.body;

  if (!type || !title || !message) {
    return res.status(400).json({ error: 'type, title, and message are required' });
  }

  try {
    const feedback = await FeedbackService.submitFeedback(userId, { type, title, message });
    return res.status(201).json(feedback);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to submit feedback' });
  }
});

// GET /api/feedback — list feedback backlog (admin/staff triage)
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const feedbackList = await FeedbackService.listFeedback(limit);
  return res.json(feedbackList);
});

export default router;
