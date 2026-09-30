import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { BulletinBoardService } from '../services/BulletinBoardService';

/**
 * Phase 3B — Plaza Bulletin Corkboard (§ Community Board)
 * GET  /api/bulletin?category=TRADE|GUILD|SOCIAL  → active 48h posts
 * POST /api/bulletin                              → create a post (auth)
 */

const PostSchema = z.object({
  category: z.enum(['TRADE', 'GUILD', 'SOCIAL']),
  title: z.string().min(3).max(60).transform((s) => s.trim()),
  body: z.string().min(5).max(300).transform((s) => s.trim()),
});

const router = Router();

router.get('/', (_req, res) => {
  const raw = typeof _req.query.category === 'string' ? _req.query.category : undefined;
  const parsed = z.enum(['TRADE', 'GUILD', 'SOCIAL']).safeParse(raw);
  const posts = BulletinBoardService.getActivePosts(parsed.success ? parsed.data : undefined);
  res.json(posts);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = PostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid post', details: parsed.error.flatten() });
  }

  try {
    const post = await BulletinBoardService.postMessage(req.user!.userId, parsed.data);
    return res.status(201).json(post);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post';
    return res.status(400).json({ error: message });
  }
});

export default router;
