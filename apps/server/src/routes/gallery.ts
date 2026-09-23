import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { CreateGalleryPhotoSchema } from '../validation/schemas';

const router = Router();

// GET /api/gallery — get photo feed
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const currentUserId = req.user!.userId;

  const photos = await prisma.galleryPhoto.findMany({
    orderBy: [{ likes: 'desc' }, { createdAt: 'desc' }],
    take: 40,
    include: {
      author: { select: { id: true, username: true } },
      photoLikes: {
        where: { userId: currentUserId },
        select: { id: true },
      },
    },
  });

  const formatted = photos.map((p) => ({
    id: p.id,
    authorId: p.authorId,
    authorName: p.author.username,
    imageUrl: p.imageUrl,
    caption: p.caption,
    likes: p.likes,
    roomName: p.roomName,
    createdAt: p.createdAt.toISOString(),
    isLikedByMe: p.photoLikes.length > 0,
  }));

  return res.json(formatted);
});

// POST /api/gallery — upload photo
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = CreateGalleryPhotoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid photo data' });

  // Check daily upload limit (max 5)
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const todayCount = await prisma.galleryPhoto.count({
    where: {
      authorId: userId,
      createdAt: { gte: startOfDay },
    },
  });

  if (todayCount >= 5) {
    return res.status(429).json({ error: 'Daily photo upload limit reached (max 5 per day)' });
  }

  const photo = await prisma.galleryPhoto.create({
    data: {
      authorId: userId,
      imageUrl: parsed.data.imageUrl,
      caption: parsed.data.caption,
      roomName: parsed.data.roomName,
      likes: 0,
    },
    include: { author: { select: { username: true } } },
  });

  return res.status(201).json(photo);
});

// POST /api/gallery/:id/like — toggle like
router.post('/:id/like', requireAuth, async (req: AuthRequest, res) => {
  const photoId = req.params.id as string;
  const userId = req.user!.userId;

  try {
    const existing = await prisma.photoLike.findUnique({
      where: { photoId_userId: { photoId, userId } },
    });

    if (existing) {
      // Unlike
      await prisma.$transaction([
        prisma.photoLike.delete({ where: { id: existing.id } }),
        prisma.galleryPhoto.update({
          where: { id: photoId },
          data: { likes: { decrement: 1 } },
        }),
      ]);
      return res.json({ liked: false });
    } else {
      // Like
      await prisma.$transaction([
        prisma.photoLike.create({ data: { photoId, userId } }),
        prisma.galleryPhoto.update({
          where: { id: photoId },
          data: { likes: { increment: 1 } },
        }),
      ]);
      return res.json({ liked: true });
    }
  } catch (err: any) {
    return res.status(400).json({ error: 'Failed to update photo like' });
  }
});

export default router;
