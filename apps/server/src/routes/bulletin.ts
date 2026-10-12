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

router.get('/paginated', (_req, res) => {
  const page = parseInt(String(_req.query.page || '1'), 10);
  const limit = parseInt(String(_req.query.limit || '10'), 10);
  const rawCategory = typeof _req.query.category === 'string' ? _req.query.category : undefined;
  const parsedCategory = z.enum(['TRADE', 'GUILD', 'SOCIAL']).safeParse(rawCategory);

  const paginated = BulletinBoardService.getPaginatedPosts(
    page,
    limit,
    parsedCategory.success ? parsedCategory.data : undefined
  );
  res.json(paginated);
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

router.post('/:id/upvote', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await BulletinBoardService.upvotePost(req.user!.userId, id);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upvote';
    return res.status(400).json({ error: message });
  }
});

router.post('/:id/report', requireAuth, async (req: AuthRequest, res) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason : 'Inappropriate content';
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await BulletinBoardService.reportPost(req.user!.userId, id, reason);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to report';
    return res.status(400).json({ error: message });
  }
});

router.post('/:id/sticky', requireAuth, async (req: AuthRequest, res) => {
  const isSticky = Boolean(req.body.isSticky);
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await BulletinBoardService.setSticky(req.user!.userId, id, isSticky);
    return res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set sticky';
    return res.status(403).json({ error: message });
  }
});

router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const isMod = req.user?.role === 'ADMIN' || req.user?.role === 'MODERATOR';
    await BulletinBoardService.deletePost(req.user!.userId, id, isMod);
    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete';
    return res.status(403).json({ error: message });
  }
});

export default router;
