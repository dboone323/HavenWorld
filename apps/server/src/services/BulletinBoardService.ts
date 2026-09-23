import { prisma } from '../prisma';

export interface BulletinPost {
  id: string;
  authorId: string;
  authorName: string;
  category: 'TRADE' | 'GUILD' | 'SOCIAL';
  title: string;
  body: string;
  createdAt: number;
  expiresAt: number;
}

export class BulletinBoardService {
  private static posts = new Map<string, BulletinPost>();

  /**
   * Posts an asynchronous message to the Plaza bulletin corkboard (48h expiration)
   */
  static async postMessage(
    userId: string,
    payload: { category: 'TRADE' | 'GUILD' | 'SOCIAL'; title: string; body: string }
  ): Promise<BulletinPost> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    if (!user) throw new Error('User not found');

    const cleanTitle = payload.title.trim().slice(0, 60);
    const cleanBody = payload.body.trim().slice(0, 300);

    if (cleanTitle.length < 3) throw new Error('Title must be at least 3 characters');
    if (cleanBody.length < 5) throw new Error('Body must be at least 5 characters');

    const id = `post_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const expiresAt = now + 48 * 3600 * 1000; // 48h

    const post: BulletinPost = {
      id,
      authorId: userId,
      authorName: user.username,
      category: payload.category,
      title: cleanTitle,
      body: cleanBody,
      createdAt: now,
      expiresAt,
    };

    this.posts.set(id, post);
    return post;
  }

  /**
   * Retrieves active, non-expired bulletin board notices
   */
  static getActivePosts(category?: 'TRADE' | 'GUILD' | 'SOCIAL'): BulletinPost[] {
    const now = Date.now();
    const active = Array.from(this.posts.values()).filter((p) => p.expiresAt > now);

    if (category) {
      return active.filter((p) => p.category === category);
    }
    return active.sort((a, b) => b.createdAt - a.createdAt);
  }
}
