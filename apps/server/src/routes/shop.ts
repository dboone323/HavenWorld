import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ShopService } from '../services/ShopService';
import { z } from 'zod';

const router = Router();

// GET /api/shop — get current 48-hour rotating shop state
router.get('/', requireAuth, async (_req, res) => {
  const state = ShopService.getShopState();
  return res.json(state);
});

const buySchema = z.object({
  itemId: z.string(),
  currency: z.enum(['COIN', 'GEM']).default('COIN'),
});

// POST /api/shop/buy — purchase item with HavenCoins or HavenGems
router.post('/buy', requireAuth, async (req: AuthRequest, res) => {
  const parsed = buySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid purchase payload' });

  try {
    const result = await ShopService.buyItem(req.user!.userId, parsed.data.itemId, parsed.data.currency);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Purchase failed' });
  }
});

// POST /api/shop/claim-daily — claim daily login streak
router.post('/claim-daily', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await ShopService.claimDailyLogin(req.user!.userId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to claim daily reward' });
  }
});

const giftSchema = z.object({
  recipientId: z.string(),
  itemId: z.string(),
  message: z.string().max(140).optional(),
});

// POST /api/shop/gift — gift item to another player
router.post('/gift', requireAuth, async (req: AuthRequest, res) => {
  const parsed = giftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid gift payload' });

  try {
    const result = await ShopService.giftItem(
      req.user!.userId,
      parsed.data.recipientId,
      parsed.data.itemId,
      parsed.data.message
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Gifting failed' });
  }
});

export default router;
