import { PhotoGalleryService } from '../PhotoGalleryService';
import { prisma } from '../../prisma';
import { redisClient, connectRedis } from '../../redis';
import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 34: Photo Gallery Album Sharing, Likes/Views & Moderation', () => {
  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  it('generates consistent perceptual hashes for images', () => {
    const hash1 = PhotoGalleryService.generatePerceptualHash('https://havenworld.games/photos/loft_01.png');
    const hash2 = PhotoGalleryService.generatePerceptualHash('https://havenworld.games/photos/loft_01.png');
    const hash3 = PhotoGalleryService.generatePerceptualHash('https://havenworld.games/photos/loft_02.png');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(16);
  });

  it('publishes photos, records unique views in Redis, toggles likes, and aggregates author stats', async () => {
    const author = await createTestUser();
    const fan = await createTestUser();

    // 1. Publish photo
    const photo = await PhotoGalleryService.publishPhoto({
      authorId: author.id,
      imageUrl: `https://havenworld.games/photos/${Date.now()}.png`,
      caption: 'Sunset over Haven Park lake! Clean sunset vibes.',
      roomName: 'Haven Park',
      category: 'PARK_NATURE',
    });

    expect(photo.id).toBeDefined();
    expect(photo.authorId).toBe(author.id);
    expect(photo.caption).toContain('Sunset over Haven Park');
    expect(photo.perceptualHash).toBeDefined();

    // 2. Record views in Redis
    const view1 = await PhotoGalleryService.recordView(photo.id, fan.id);
    expect(view1).toBeGreaterThanOrEqual(1);

    // Same viewer duplicate view should not inflate unique views
    const view2 = await PhotoGalleryService.recordView(photo.id, fan.id);
    expect(view2).toBe(view1);

    const viewCount = await PhotoGalleryService.getViewCount(photo.id);
    expect(viewCount).toBe(view1);

    // 3. Toggle like
    const likeRes1 = await PhotoGalleryService.toggleLike(photo.id, fan.id);
    expect(likeRes1.liked).toBe(true);
    expect(likeRes1.likes).toBe(1);

    // Verify feed reflects like state for fan
    const feed = await PhotoGalleryService.getFeed({
      category: 'PARK_NATURE',
      viewerId: fan.id,
      pageSize: 10,
    });

    const feedItem = feed.photos.find((p) => p.id === photo.id);
    expect(feedItem).toBeDefined();
    expect(feedItem?.isLikedByMe).toBe(true);
    expect(feedItem?.likes).toBe(1);
    expect(feedItem?.views).toBe(viewCount);

    // Unlike
    const likeRes2 = await PhotoGalleryService.toggleLike(photo.id, fan.id);
    expect(likeRes2.liked).toBe(false);
    expect(likeRes2.likes).toBe(0);

    // 4. Author gallery stats
    const stats = await PhotoGalleryService.getAuthorStats(author.id);
    expect(stats.authorId).toBe(author.id);
    expect(stats.totalPhotos).toBeGreaterThanOrEqual(1);

    // Cleanup
    if (redisClient.isOpen) {
      await redisClient.del(`photo:views:${photo.id}`);
      await redisClient.del(`photo:viewers:${photo.id}`);
      await redisClient.sRem('gallery:category:PARK_NATURE', photo.id);
    }
    await prisma.photoLike.deleteMany({ where: { photoId: photo.id } });
    await prisma.galleryPhoto.delete({ where: { id: photo.id } });
    await prisma.avatar.deleteMany({ where: { userId: { in: [author.id, fan.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [author.id, fan.id] } } });
  });
});
