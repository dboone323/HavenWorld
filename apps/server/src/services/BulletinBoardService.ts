import { prisma } from '../prisma';
import { redis } from '../redis';

export interface BulletinPost {
  id: string;
  authorId: string;
  authorName: string;
  category: 'TRADE' | 'GUILD' | 'SOCIAL';
  title: string;
  body: string;
  createdAt: number;
  expiresAt: number;
  isSticky?: boolean;
  upvotes?: number;
  isFlagged?: boolean;
}

export class BulletinBoardService {
  private static posts = new Map<string, BulletinPost>();

  /**
   * Posts an asynchronous message to the Plaza bulletin corkboard (48h expiration)
   */
  static async postMessage(
    userId: string,
    payload: { category: 'TRADE' | 'GUILD' | 'SOCIAL'; title: string; body: string; isSticky?: boolean }
  ): Promise<BulletinPost> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, role: true },
    });

    if (!user) throw new Error('User not found');

    const cleanTitle = payload.title.trim().slice(0, 60);
    const cleanBody = payload.body.trim().slice(0, 300);

    if (cleanTitle.length < 3) throw new Error('Title must be at least 3 characters');
    if (cleanBody.length < 5) throw new Error('Body must be at least 5 characters');

    const id = `post_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const expiresAt = now + 48 * 3600 * 1000; // 48h

    const isSticky = Boolean(payload.isSticky && user.role === 'ADMIN');

    const post: BulletinPost = {
      id,
      authorId: userId,
      authorName: user.username,
      category: payload.category,
      title: cleanTitle,
      body: cleanBody,
      createdAt: now,
      expiresAt,
      isSticky,
      upvotes: 0,
      isFlagged: false,
    };

    this.posts.set(id, post);
    return post;
  }

  /**
   * Upvotes a bulletin notice (idempotent per user via Redis set)
   */
  static async upvotePost(userId: string, postId: string): Promise<{ upvotes: number; userVoted: boolean }> {
    const post = this.posts.get(postId);
    if (!post) throw new Error('Post not found');

    const votersKey = `bulletin:post:${postId}:voters`;
    const isMember = await redis.sIsMember(votersKey, userId);

    if (isMember) {
      await redis.sRem(votersKey, userId);
      post.upvotes = Math.max(0, (post.upvotes ?? 1) - 1);
      return { upvotes: post.upvotes, userVoted: false };
    } else {
      await redis.sAdd(votersKey, userId);
      post.upvotes = (post.upvotes ?? 0) + 1;
      return { upvotes: post.upvotes, userVoted: true };
    }
  }

  /**
   * Flags a post for moderation review
   */
  static async reportPost(userId: string, postId: string, reason: string): Promise<{ reportCount: number; isFlagged: boolean }> {
    const post = this.posts.get(postId);
    if (!post) throw new Error('Post not found');

    const reportsKey = `bulletin:post:${postId}:reports`;
    await redis.sAdd(reportsKey, `${userId}:${reason.trim().slice(0, 100)}`);
    const count = await redis.sCard(reportsKey);

    if (count >= 3) {
      post.isFlagged = true;
    }

    return { reportCount: count, isFlagged: Boolean(post.isFlagged) };
  }

  /**
   * Sets sticky status on a post (admin only)
   */
  static async setSticky(userId: string, postId: string, isSticky: boolean): Promise<BulletinPost> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role !== 'ADMIN') throw new Error('Only admins can pin sticky announcements');

    const post = this.posts.get(postId);
    if (!post) throw new Error('Post not found');

    post.isSticky = isSticky;
    return post;
  }

  /**
   * Deletes a bulletin notice (author or moderator)
   */
  static async deletePost(userId: string, postId: string, isModerator = false): Promise<boolean> {
    const post = this.posts.get(postId);
    if (!post) throw new Error('Post not found');

    if (post.authorId !== userId && !isModerator) {
      throw new Error('Unauthorized to delete this post');
    }

    this.posts.delete(postId);
    await redis.del(`bulletin:post:${postId}:voters`);
    await redis.del(`bulletin:post:${postId}:reports`);
    return true;
  }

  /**
   * Retrieves paginated active posts with sticky pins at the top
   */
  static getPaginatedPosts(
    page: number = 1,
    limit: number = 10,
    category?: 'TRADE' | 'GUILD' | 'SOCIAL'
  ): { posts: BulletinPost[]; total: number; page: number; totalPages: number } {
    const all = this.getActivePosts(category);
    const sorted = all.sort((a, b) => {
      if (a.isSticky && !b.isSticky) return -1;
      if (!a.isSticky && b.isSticky) return 1;
      return b.createdAt - a.createdAt;
    });

    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(50, limit));
    const offset = (safePage - 1) * safeLimit;
    const paginated = sorted.slice(offset, offset + safeLimit);

    return {
      posts: paginated,
      total: sorted.length,
      page: safePage,
      totalPages: Math.ceil(sorted.length / safeLimit),
    };
  }

  /**
   * Retrieves active, non-expired bulletin board notices
   */
  static getActivePosts(category?: 'TRADE' | 'GUILD' | 'SOCIAL'): BulletinPost[] {
    const now = Date.now();
    const active = Array.from(this.posts.values()).filter((p) => p.expiresAt > now && !p.isFlagged);

    if (category) {
      return active.filter((p) => p.category === category);
    }
    return active.sort((a, b) => {
      if (a.isSticky && !b.isSticky) return -1;
      if (!a.isSticky && b.isSticky) return 1;
      return b.createdAt - a.createdAt;
    });
  }
}
