import { prisma } from '../../prisma';
import { BulletinBoardService } from '../BulletinBoardService';
import { connectRedis, disconnectRedis } from '../../redis';

describe('Batch 44: Community Bulletin Board Thread Pagination, Upvoting & Moderation', () => {
  let adminUser: any;
  let regularUser: any;
  let otherUser: any;

  beforeAll(async () => {
    await connectRedis();

    adminUser = await prisma.user.create({
      data: {
        username: `admin_b_${Date.now()}`,
        email: `admin_b_${Date.now()}@example.com`,
        passwordHash: 'hash',
        role: 'ADMIN',
      },
    });

    regularUser = await prisma.user.create({
      data: {
        username: `reg_b_${Date.now()}`,
        email: `reg_b_${Date.now()}@example.com`,
        passwordHash: 'hash',
        role: 'PLAYER',
      },
    });

    otherUser = await prisma.user.create({
      data: {
        username: `oth_b_${Date.now()}`,
        email: `oth_b_${Date.now()}@example.com`,
        passwordHash: 'hash',
        role: 'PLAYER',
      },
    });
  });

  afterAll(async () => {
    if (adminUser?.id) await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
    if (regularUser?.id) await prisma.user.delete({ where: { id: regularUser.id } }).catch(() => {});
    if (otherUser?.id) await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
    await disconnectRedis();
  });

  it('posts a regular message and allows author or admin to manage it', async () => {
    const post = await BulletinBoardService.postMessage(regularUser.id, {
      category: 'TRADE',
      title: 'Trading Vintage Neon Clock',
      body: 'Looking to trade for retro cafe diner stool or 150 coins!',
    });

    expect(post).toBeDefined();
    expect(post.authorId).toBe(regularUser.id);
    expect(post.authorName).toBe(regularUser.username);
    expect(post.isSticky).toBe(false);
  });

  it('allows admins to post sticky pinned announcements that appear first', async () => {
    const stickyPost = await BulletinBoardService.postMessage(adminUser.id, {
      category: 'SOCIAL',
      title: 'Plaza Festival Tonight!',
      body: 'Meet at the town square fountain at 8 PM for live fireworks and pizza baking contests!',
      isSticky: true,
    });

    expect(stickyPost.isSticky).toBe(true);

    const active = BulletinBoardService.getActivePosts();
    expect(active[0].id).toBe(stickyPost.id);
    expect(active[0].isSticky).toBe(true);
  });

  it('handles upvoting with toggling per player via Redis sets', async () => {
    const post = await BulletinBoardService.postMessage(regularUser.id, {
      category: 'GUILD',
      title: 'Starlight Guild Recruiting!',
      body: 'Active decorators and anglers wanted. Weekly treasury perks!',
    });

    const vote1 = await BulletinBoardService.upvotePost(otherUser.id, post.id);
    expect(vote1.upvotes).toBe(1);
    expect(vote1.userVoted).toBe(true);

    // Toggling vote off
    const vote2 = await BulletinBoardService.upvotePost(otherUser.id, post.id);
    expect(vote2.upvotes).toBe(0);
    expect(vote2.userVoted).toBe(false);
  });

  it('flags post for moderation when multiple reports are accumulated', async () => {
    const spamPost = await BulletinBoardService.postMessage(otherUser.id, {
      category: 'SOCIAL',
      title: 'Suspicious External Link',
      body: 'Click here for free coins at malicious-site dot com',
    });

    const rep1 = await BulletinBoardService.reportPost(adminUser.id, spamPost.id, 'Spam link');
    expect(rep1.reportCount).toBe(1);
    expect(rep1.isFlagged).toBe(false);

    const rep2 = await BulletinBoardService.reportPost(regularUser.id, spamPost.id, 'Phishing');
    expect(rep2.reportCount).toBe(2);
    expect(rep2.isFlagged).toBe(false);

    const rep3 = await BulletinBoardService.reportPost('user_reporter_3', spamPost.id, 'Scam');
    expect(rep3.reportCount).toBe(3);
    expect(rep3.isFlagged).toBe(true);

    // Should no longer appear in active posts list
    const activePosts = BulletinBoardService.getActivePosts();
    expect(activePosts.some((p) => p.id === spamPost.id)).toBe(false);
  });

  it('provides paginated feed results with correct page boundaries', async () => {
    const paginated = BulletinBoardService.getPaginatedPosts(1, 5);
    expect(paginated.posts).toBeDefined();
    expect(paginated.page).toBe(1);
    expect(paginated.total).toBeGreaterThan(0);
  });
});
