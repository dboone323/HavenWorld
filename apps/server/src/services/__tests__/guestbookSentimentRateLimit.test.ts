import { GuestbookService } from '../GuestbookService';
 import { prisma } from '../../prisma';
 import { redisClient, connectRedis } from '../../redis';
 import { createTestUser } from '../../../__tests__/helpers/factories';

describe('Batch 33: Guestbook Sentiment Analysis, Rate Limiting & Pinned Entries', () => {
  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  describe('Sentiment & Spam Pattern Analysis', () => {
    it('flags spam phrases, prohibited links, and character flooding', () => {
      const linkCheck = GuestbookService.analyzeSentimentAndSpam('Join my server http://freecoins.com now!');
      expect(linkCheck.allowed).toBe(false);
      expect(linkCheck.spamFlags).toContain('LINK_PROHIBITED');

      const floodCheck = GuestbookService.analyzeSentimentAndSpam('Helloooooooo there!!!!!!');
      expect(floodCheck.allowed).toBe(false);
      expect(floodCheck.spamFlags).toContain('CHARACTER_FLOODING');

      const scamCheck = GuestbookService.analyzeSentimentAndSpam('Claim your free coins today!');
      expect(scamCheck.allowed).toBe(false);
      expect(scamCheck.spamFlags).toContain('SPAM_PHRASE');
    });

    it('correctly classifies positive, neutral, and negative sentiment messages', () => {
      const positive = GuestbookService.analyzeSentimentAndSpam('Love this cozy loft! The vibes are awesome and sweet.');
      expect(positive.allowed).toBe(true);
      expect(positive.sentiment).toBe('POSITIVE');

      const neutral = GuestbookService.analyzeSentimentAndSpam('Just stopping by to explore the neighborhood.');
      expect(neutral.allowed).toBe(true);
      expect(neutral.sentiment).toBe('NEUTRAL');

      const negative = GuestbookService.analyzeSentimentAndSpam('This room is ugly, trash, and terrible.');
      expect(negative.allowed).toBe(true);
      expect(negative.sentiment).toBe('NEGATIVE');
    });
  });

  describe('Real Database & Redis Lifecycle', () => {
    it('enforces rate limits, stores guestbook entries, and supports owner pinning with pagination', async () => {
      const owner = await createTestUser();
      const visitor = await createTestUser();

      const room = await prisma.room.create({
        data: {
          name: 'Cozy Mountain Loft',
          ownerId: owner.id,
          isPublic: true,
        },
      });

      // 1. Visitor signs guestbook
      const entry1 = await GuestbookService.signBook(
        room.id,
        visitor.id,
        'Such a cozy and awesome loft! Love the decorations.'
      );
      expect(entry1).toBeDefined();
      expect(entry1.message).toContain('cozy and awesome loft');

      // 2. Immediate second sign by same visitor is blocked by rate limit
      await expect(
        GuestbookService.signBook(room.id, visitor.id, 'Second message right away!')
      ).rejects.toThrow('Guestbook cooldown active');

      // 3. Owner pins entry1
      const pinResult = await GuestbookService.pinEntry(room.id, entry1.id, owner.id);
      expect(pinResult.pinned).toBe(true);
      expect(pinResult.entryId).toBe(entry1.id);

      // Non-owner cannot pin
      await expect(
        GuestbookService.pinEntry(room.id, entry1.id, visitor.id)
      ).rejects.toThrow('Only the room owner can pin guestbook entries');

      // 4. Fetch paginated entries and verify pinned state
      const pageResult = await GuestbookService.getPage(room.id, 1, 10);
      expect(pageResult.totalEntries).toBeGreaterThanOrEqual(1);
      expect(pageResult.pinnedId).toBe(entry1.id);
      expect(pageResult.entries[0].id).toBe(entry1.id);
      expect(pageResult.entries[0].isPinned).toBe(true);

      // 5. Owner unpins entry
      const unpinResult = await GuestbookService.unpinEntry(room.id, owner.id);
      expect(unpinResult.unpinned).toBe(true);

      // Cleanup
      if (redisClient.isOpen) {
        await redisClient.del(`guestbook:ratelimit:${room.id}:${visitor.id}`);
        await redisClient.del(`guestbook:pinned:${room.id}`);
      }
      await prisma.guestbookEntry.deleteMany({ where: { roomId: room.id } });
      await prisma.room.delete({ where: { id: room.id } });
      await prisma.avatar.deleteMany({ where: { userId: { in: [owner.id, visitor.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, visitor.id] } } });
    });
  });
});
