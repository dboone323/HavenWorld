import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { CRAFTING_RECIPES } from '@havenworld/shared';
import { prisma } from '../prisma';

const router = Router();

// GET /api/workshop/recipes — returns available crafting recipes
router.get('/recipes', requireAuth, (_req, res) => {
  return res.json(CRAFTING_RECIPES);
});

// GET /api/workshop/materials — returns user's material inventory & active crafting queue
router.get('/materials', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [materials, queue] = await Promise.all([
      prisma.materialInventory.findUnique({ where: { userId } }),
      prisma.craftingQueue.findMany({
        where: { userId },
        orderBy: { completesAt: 'asc' },
      }),
    ]);

    return res.json({
      materials: materials || {
        timber: 0,
        scrapMetal: 0,
        fabric: 0,
        crystalShard: 0,
      },
      queue,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load workshop data' });
  }
});

export default router;
