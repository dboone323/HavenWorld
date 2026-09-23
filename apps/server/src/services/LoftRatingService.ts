import { prisma } from '../prisma';

export class LoftRatingService {
  private static userUpvotes = new Set<string>(); // "userId:roomId"

  /**
   * Casts an upvote/like for a room with strict 1-vote-per-user deduplication
   */
  static async upvoteRoom(userId: string, roomId: string) {
    const key = `${userId}:${roomId}`;
    if (this.userUpvotes.has(key)) {
      throw new Error('You have already upvoted this loft');
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true, ownerId: true },
    });

    if (!room) throw new Error('Room not found');
    if (room.ownerId === userId) {
      throw new Error('Cannot upvote your own room');
    }

    this.userUpvotes.add(key);

    // Record as telemetry event
    await prisma.gameEvent.create({
      data: {
        event: 'LOFT_UPVOTE',
        userId,
        roomId,
      },
    });

    const totalUpvotes = await prisma.gameEvent.count({
      where: { event: 'LOFT_UPVOTE', roomId },
    });

    return {
      roomId,
      totalUpvotes,
      hasUpvoted: true,
    };
  }

  /**
   * Retrieves trending lofts ordered by upvotes
   */
  static async getTrendingLofts(limit: number = 10) {
    const topRooms = await prisma.gameEvent.groupBy({
      by: ['roomId'],
      where: { event: 'LOFT_UPVOTE', roomId: { not: null } },
      _count: { roomId: true },
      orderBy: { _count: { roomId: 'desc' } },
      take: limit,
    });

    const roomIds = topRooms.map((r) => r.roomId!).filter(Boolean);
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      include: { owner: { select: { id: true, username: true } } },
    });

    const roomMap = new Map(rooms.map((r) => [r.id, r]));

    return topRooms.map((tr) => {
      const room = roomMap.get(tr.roomId!);
      return {
        roomId: tr.roomId!,
        name: room?.name || 'Sanctuary',
        ownerName: room?.owner?.username || 'Resident',
        upvotes: tr._count.roomId,
      };
    });
  }
}
