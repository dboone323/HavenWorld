import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { SeasonalThemeService } from '../services/SeasonalThemeService';

const router = Router();

// GET /api/world/seasonal-theme — returns dynamic seasonal overlay configuration
router.get('/seasonal-theme', requireAuth, (req, res) => {
  let targetDate = new Date();
  if (typeof req.query.date === 'string' && req.query.date.trim()) {
    const parsed = new Date(req.query.date);
    if (!Number.isNaN(parsed.getTime())) {
      targetDate = parsed;
    }
  }
  const config = SeasonalThemeService.getSeasonalConfig(targetDate);
  return res.json(config);
});

export default router;
