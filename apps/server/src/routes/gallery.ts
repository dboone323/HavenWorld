import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { CreateGalleryPhotoSchema } from '../validation/schemas';
import { PhotoGalleryService, GalleryAlbumCategory } from '../services/PhotoGalleryService';

const router = Router();

// GET /api/gallery — get photo feed
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const currentUserId = req.user!.userId;
  const sort = req.query.sort === 'popular' ? 'popular' : 'recent';
  const category = req.query.category as GalleryAlbumCategory | undefined;
  const page = parseInt(String(req.query.page || '1'), 10) || 1;
  const pageSize = parseInt(String(req.query.pageSize || '40'), 10) || 40;

  try {
    const feed = await PhotoGalleryService.getFeed({
      category,
      sort,
      viewerId: currentUserId,
      page,
      pageSize,
    });
    return res.json(feed.photos);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch gallery feed' });
  }
});

// POST /api/gallery — upload photo
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = CreateGalleryPhotoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo data' });

  try {
    const photo = await PhotoGalleryService.publishPhoto({
      authorId: userId,
      imageUrl: parsed.data.imageUrl,
      caption: parsed.data.caption,
      roomName: parsed.data.roomName,
      category: req.body.category as GalleryAlbumCategory,
    });
    return res.status(201).json(photo);
  } catch (err: any) {
    const status = err.message.includes('limit reached') ? 429 : 400;
    return res.status(status).json({ error: err.message || 'Failed to publish photo' });
  }
});

// POST /api/gallery/:id/like — toggle like
router.post('/:id/like', requireAuth, async (req: AuthRequest, res) => {
  const photoId = req.params.id as string;
  const userId = req.user!.userId;

  try {
    const result = await PhotoGalleryService.toggleLike(photoId, userId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update photo like' });
  }
});

// POST /api/gallery/:id/view — record photo view
router.post('/:id/view', requireAuth, async (req: AuthRequest, res) => {
  const photoId = req.params.id as string;
  const userId = req.user!.userId;

  try {
    const views = await PhotoGalleryService.recordView(photoId, userId);
    return res.json({ views });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to record photo view' });
  }
});

// GET /api/gallery/authors/:authorId/stats — get author stats
router.get('/authors/:authorId/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const stats = await PhotoGalleryService.getAuthorStats(req.params.authorId as string);
    return res.json(stats);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to fetch author stats' });
  }
});

export default router;
