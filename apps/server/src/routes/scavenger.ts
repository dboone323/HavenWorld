import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ScavengerHuntService } from '../services/ScavengerHuntService';

const router = Router();

// GET /api/scavenger/targets — list active unclaimed scavenger tickets (optionally by roomId)
router.get('/targets', requireAuth, (req, res) => {
  const roomId = typeof req.query.roomId === 'string' && req.query.roomId.trim()
    ? req.query.roomId.trim()
    : undefined;
  const targets = ScavengerHuntService.getActiveTickets(roomId);
  return res.json(targets);
});

// GET /api/scavenger/clues/current — get player's active scavenger hunt riddle and progress
router.get('/clues/current', requireAuth, (req: AuthRequest, res) => {
  const progress = ScavengerHuntService.getUserProgress(req.user!.userId);
  return res.json(progress);
});

const solveClueSchema = z.object({
  clueIndex: z.number().int().positive(),
  roomId: z.string().min(1),
  solutionToken: z.string().min(1),
});

// POST /api/scavenger/clues/solve — submit cryptographic clue solution to advance quest
router.post('/clues/solve', requireAuth, async (req: AuthRequest, res) => {
  const parsed = solveClueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid clue solution payload',
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await ScavengerHuntService.solveClue(
      req.user!.userId,
      parsed.data.clueIndex,
      parsed.data.roomId,
      parsed.data.solutionToken
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to solve scavenger clue' });
  }
});

const claimTicketSchema = z.object({
  ticketId: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  playerX: z.number().finite().optional(),
  playerY: z.number().finite().optional(),
});

// POST /api/scavenger/claim — claim a scavenger ticket by proximity
router.post('/claim', requireAuth, async (req: AuthRequest, res) => {
  const parsed = claimTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid scavenger claim payload',
      issues: parsed.error.issues,
    });
  }

  const playerX = parsed.data.playerX ?? parsed.data.x ?? 0;
  const playerY = parsed.data.playerY ?? parsed.data.y ?? 0;

  try {
    const result = await ScavengerHuntService.claimTicket(
      parsed.data.ticketId,
      req.user!.userId,
      playerX,
      playerY
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to claim scavenger ticket' });
  }
});

export default router;
