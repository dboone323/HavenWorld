import { prisma } from '../prisma';
import { redisClient } from '../redis';
import { getIO } from '../sockets';
import { SOCKET_EVENTS, ClubRole } from '@havenworld/shared';

export class ClubService {
  /**
   * Creates a new player club (deducts 500 HavenCoins)
   */
  static async createClub(ownerId: string, name: string, motto?: string, tag?: string) {
    const cleanName = name.trim().slice(0, 24);
    if (cleanName.length < 3) throw new Error('Club name must be at least 3 characters');

    return await prisma.$transaction(async (tx) => {
      const existingMembership = await tx.clubMember.findUnique({ where: { userId: ownerId } });
      if (existingMembership) throw new Error('You are already a member of a club');

      const owner = await tx.user.findUnique({ where: { id: ownerId } });
      if (!owner || owner.havenCoins < 500) throw new Error('Insufficient HavenCoins (500 required)');

      // Deduct fee
      await tx.user.update({
        where: { id: ownerId },
        data: { havenCoins: { decrement: 500 } },
      });

      // Create dedicated clubhouse room
      const clubRoom = await tx.room.create({
        data: {
          name: `${cleanName} Clubhouse`,
          description: `Headquarters of ${cleanName}`,
          ownerId,
          isPublic: false,
          theme: 'clubhouse',
          backgroundKey: 'map-personal-room',
        },
      });

      const club = await tx.club.create({
        data: {
          name: cleanName,
          motto: motto ? motto.trim().slice(0, 80) : null,
          tag: tag ? tag.trim().slice(0, 5).toUpperCase() : null,
          ownerId,
          roomId: clubRoom.id,
        },
      });

      await tx.clubMember.create({
        data: {
          clubId: club.id,
          userId: ownerId,
          role: 'OWNER',
        },
      });

      return club;
    });
  }

  /**
   * Invites or adds a member to the club (up to 50 members)
   */
  static async addMember(inviterId: string, clubId: string, targetUserId: string) {
    const inviter = await prisma.clubMember.findUnique({ where: { userId: inviterId } });
    if (!inviter || inviter.clubId !== clubId || inviter.role === 'MEMBER') {
      throw new Error('Only the club Owner or Officers can invite members');
    }

    const memberCount = await prisma.clubMember.count({ where: { clubId } });
    if (memberCount >= 50) throw new Error('Club is full (max 50 members)');

    const existing = await prisma.clubMember.findUnique({ where: { userId: targetUserId } });
    if (existing) throw new Error('Player is already in a club');

    return await prisma.clubMember.create({
      data: {
        clubId,
        userId: targetUserId,
        role: 'MEMBER',
      },
    });
  }

  /**
   * Kicks a member from the club
   */
  static async kickMember(requesterId: string, clubId: string, targetUserId: string) {
    const requester = await prisma.clubMember.findUnique({ where: { userId: requesterId } });
    if (!requester || requester.clubId !== clubId || requester.role === 'MEMBER') {
      throw new Error('Unauthorized to kick members');
    }

    const target = await prisma.clubMember.findUnique({ where: { userId: targetUserId } });
    if (!target || target.clubId !== clubId) throw new Error('Target is not in this club');
    if (target.role === 'OWNER') throw new Error('Cannot kick the club owner');

    return await prisma.clubMember.delete({ where: { userId: targetUserId } });
  }

  /**
   * Sends a persistent chat message to the club channel backed by Redis (48h retention)
   */
  static async sendClubMessage(userId: string, clubId: string, content: string) {
    const member = await prisma.clubMember.findUnique({
      where: { userId },
      include: { user: { select: { username: true } } },
    });

    if (!member || member.clubId !== clubId) {
      throw new Error('You are not a member of this club');
    }

    const messagePayload = {
      id: `club_msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderId: userId,
      senderName: member.user.username,
      content: content.slice(0, 200),
      timestamp: Date.now(),
    };

    // Store in Redis list with 48h TTL
    const redisKey = `club:chat:${clubId}`;
    if (redisClient.isOpen) {
      await redisClient.lPush(redisKey, JSON.stringify(messagePayload));
      await redisClient.lTrim(redisKey, 0, 99); // keep last 100 messages
      await redisClient.expire(redisKey, 48 * 3600);
    }

    const io = getIO();
    if (io) {
      io.to(`club:${clubId}`).emit(SOCKET_EVENTS.CLUB_CHAT_MESSAGE, messagePayload);
    }

    return messagePayload;
  }
}
