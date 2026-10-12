import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { TransitService } from '../services/TransitService';

const router = Router();

// GET /api/transit/schedule — returns current tram state, stations, and boarded passengers
router.get('/schedule', requireAuth, (_req, res) => {
  return res.json(TransitService.getStatus());
});

// GET /api/transit/stations — returns dynamic station schedule and arrival estimates
router.get('/stations', requireAuth, (_req, res) => {
  return res.json({
    stations: TransitService.getStationSchedule(),
    currentStation: TransitService.currentStation,
    nextStation: TransitService.nextStation,
  });
});

// GET /api/transit/announcement — returns current station audio/visual announcement
router.get('/announcement', requireAuth, (_req, res) => {
  return res.json(TransitService.getAnnouncement());
});

// POST /api/transit/tickets/purchase — purchases a 24h transit ticket using HavenCoins
router.post('/tickets/purchase', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await TransitService.purchaseTicket(req.user!.userId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Ticket purchase failed' });
  }
});

const boardTramSchema = z.object({
  stationId: z.string().min(1).max(128).default('Plaza Central Station'),
  requireTicket: z.boolean().optional().default(false),
});

// POST /api/transit/board — board the Haven Tram while in BOARDING state
router.post('/board', requireAuth, (req: AuthRequest, res) => {
  const parsed = boardTramSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid transit board payload',
      issues: parsed.error.issues,
    });
  }

  try {
    const result = TransitService.boardTram(req.user!.userId, parsed.data.stationId, {
      requireTicket: parsed.data.requireTicket,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to board tram' });
  }
});

// POST /api/transit/leave — disembark from the Haven Tram
router.post('/leave', requireAuth, (req: AuthRequest, res) => {
  const result = TransitService.leaveTram(req.user!.userId);
  return res.json(result);
});

export default router;
