import crypto from 'crypto';
import { prisma } from '../prisma';
import { redisClient } from '../redis';
import { moderateMessage } from './ModerationService';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export type GalleryAlbumCategory =
  | 'LOFT_SHOWCASE'
  | 'PARK_NATURE'
  | 'FESTIVAL_EVENTS'
  | 'AVATAR_FASHION'
  | 'PET_COMPANIONS'
  | 'COMMUNITY';

export interface PublishPhotoParams {
  authorId: string;
  imageUrl: string;
  caption?: string;
  roomName: string;
  category?: GalleryAlbumCategory;
}

export class PhotoGalleryService {
  /**
   * Generates a 64-bit cryptographic perceptual hash from image URL or payload
   */
  static generatePerceptualHash(imageUrl: string): string {
    return crypto.createHash('sha256').update(imageUrl.trim()).digest('hex').slice(0, 16);
  }

  /**
   * Publishes a photo to the world gallery album
   */
  static async publishPhoto(params: PublishPhotoParams) {
    const { authorId, imageUrl, caption, roomName, category = 'COMMUNITY' } = params;

    if (!imageUrl || !imageUrl.trim()) {
      throw new Error('Image URL is required');
    }

    // Check daily upload limit (max 5)
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const todayCount = await prisma.galleryPhoto.count({
      where: {
        authorId,
        createdAt: { gte: startOfDay },
      },
    });

    if (todayCount >= 5) {
      throw new Error('Daily photo upload limit reached (max 5 per day)');
    }

    const cleanedCaption = caption ? moderateMessage(caption.slice(0, 80)).filtered : null;
    const pHash = this.generatePerceptualHash(imageUrl);

    const photo = await prisma.galleryPhoto.create({
      data: {
        authorId,
        imageUrl: imageUrl.trim(),
        caption: cleanedCaption,
        roomName: (roomName || 'Haven Park').slice(0, 40),
        perceptualHash: pHash,
        likes: 0,
      },
      include: {
        author: { select: { id: true, username: true } },
      },
    });

    // Cache category in Redis tag set
    if (redisClient.isOpen) {
      await redisClient.sAdd(`gallery:category:${category}`, photo.id);
    }

    return {
      ...photo,
      category,
    };
  }

  /**
   * Toggles like on a photo with atomic transaction
   */
  static async toggleLike(photoId: string, userId: string) {
    const existing = await prisma.photoLike.findUnique({
      where: { photoId_userId: { photoId, userId } },
    });

    if (existing) {
      // Unlike
      const [_, updated] = await prisma.$transaction([
        prisma.photoLike.delete({ where: { id: existing.id } }),
        prisma.galleryPhoto.update({
          where: { id: photoId },
          data: { likes: { decrement: 1 } },
        }),
      ]);

      return { liked: false, likes: Math.max(0, updated.likes) };
    } else {
      // Like
      const [_, updated] = await prisma.$transaction([
        prisma.photoLike.create({ data: { photoId, userId } }),
        prisma.galleryPhoto.update({
          where: { id: photoId },
          data: { likes: { increment: 1 } },
        }),
      ]);

      const io = getIO();
      if (io) {
        io.emit(SOCKET_EVENTS.PHOTO_LIKED, { photoId, likes: updated.likes });
      }

      return { liked: true, likes: updated.likes };
    }
  }

  /**
   * Records a unique photo view in Redis
   */
  static async recordView(photoId: string, viewerId?: string): Promise<number> {
    if (!redisClient.isOpen) return 1;

    const viewsKey = `photo:views:${photoId}`;
    if (viewerId) {
      const viewerSetKey = `photo:viewers:${photoId}`;
      const isNew = await redisClient.sAdd(viewerSetKey, viewerId);
      if (isNew) {
        await redisClient.expire(viewerSetKey, 86400 * 7); // 7-day retention
        return await redisClient.incr(viewsKey);
      }
      const current = await redisClient.get(viewsKey);
      return current ? parseInt(current, 10) : 1;
    }

    return await redisClient.incr(viewsKey);
  }

  /**
   * Retrieves current view count for a photo
   */
  static async getViewCount(photoId: string): Promise<number> {
    if (!redisClient.isOpen) return 0;
    const views = await redisClient.get(`photo:views:${photoId}`);
    return views ? parseInt(views, 10) : 0;
  }

  /**
   * Retrieves gallery feed with optional category filtering and sorting
   */
  static async getFeed(options: {
    category?: GalleryAlbumCategory;
    sort?: 'popular' | 'recent';
    viewerId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { sort = 'recent', viewerId, page = 1, pageSize = 20 } = options;
    const take = Math.min(50, Math.max(1, pageSize));
    const skip = Math.max(0, (page - 1) * take);

    const orderBy: any = sort === 'popular' ? [{ likes: 'desc' }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }];

    const [photos, total] = await Promise.all([
      prisma.galleryPhoto.findMany({
        orderBy,
        take,
        skip,
        include: {
          author: { select: { id: true, username: true } },
          photoLikes: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
        },
      }),
      prisma.galleryPhoto.count(),
    ]);

    const formatted = await Promise.all(
      photos.map(async (p: any) => {
        const views = await this.getViewCount(p.id);
        return {
          id: p.id,
          authorId: p.authorId,
          authorName: p.author.username,
          imageUrl: p.imageUrl,
          caption: p.caption,
          likes: p.likes,
          views,
          roomName: p.roomName,
          perceptualHash: p.perceptualHash,
          createdAt: p.createdAt.toISOString(),
          isLikedByMe: viewerId ? Boolean(p.photoLikes?.length > 0) : false,
        };
      })
    );

    return {
      photos: formatted,
      page,
      pageSize: take,
      totalPages: Math.ceil(total / take) || 1,
      totalPhotos: total,
    };
  }

  /**
   * Computes aggregate author gallery statistics
   */
  static async getAuthorStats(authorId: string) {
    const photos = await prisma.galleryPhoto.findMany({
      where: { authorId },
      select: { id: true, likes: true },
    });

    const totalPhotos = photos.length;
    const totalLikes = photos.reduce((sum: number, p: { id: string; likes: number }) => sum + p.likes, 0);

    let totalViews = 0;
    for (const p of photos) {
      totalViews += await this.getViewCount(p.id);
    }

    return {
      authorId,
      totalPhotos,
      totalLikes,
      totalViews,
    };
  }
}
