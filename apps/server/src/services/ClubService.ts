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

      // Deduct fee atomically
      const updated = await tx.user.updateMany({
        where: { id: ownerId, havenCoins: { gte: 500 } },
        data: { havenCoins: { decrement: 500 } },
      });
      if (updated.count === 0) throw new Error('Insufficient HavenCoins (500 required)');

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

      getIO()?.in(`user:${ownerId}`).socketsJoin(`club:${club.id}`);
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

    const created = await prisma.clubMember.create({
      data: {
        clubId,
        userId: targetUserId,
        role: 'MEMBER',
      },
    });
    getIO()?.in(`user:${targetUserId}`).socketsJoin(`club:${clubId}`);
    return created;
  }

  /**
   * Directly joins a club
   */
  static async joinClub(userId: string, clubId: string) {
    const existing = await prisma.clubMember.findUnique({ where: { userId } });
    if (existing) throw new Error('You are already a member of a club');

    const memberCount = await prisma.clubMember.count({ where: { clubId } });
    if (memberCount >= 50) throw new Error('Club is full (max 50 members)');

    const created = await prisma.clubMember.create({
      data: {
        clubId,
        userId,
        role: 'MEMBER',
      },
    });
    getIO()?.in(`user:${userId}`).socketsJoin(`club:${clubId}`);
    return created;
  }

  /**
   * Retrieves full club details including members and clubhouse
   */
  static async getClubDetails(clubId: string) {
    return await prisma.club.findUnique({
      where: { id: clubId },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, lastLoginAt: true } } },
        },
        room: true,
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

    const deleted = await prisma.clubMember.delete({ where: { userId: targetUserId } });
    getIO()?.in(`user:${targetUserId}`).socketsLeave(`club:${clubId}`);
    return deleted;
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
      io.in(`user:${userId}`).socketsJoin(`club:${clubId}`);
      io.to(`club:${clubId}`).emit(SOCKET_EVENTS.CLUB_CHAT_MESSAGE, messagePayload);
    }

    return messagePayload;
  }

  /**
   * Calculates club level, perks, and threshold given treasury balance
   */
  static calculateTreasuryTier(balance: number) {
    if (balance >= 20000) {
      return {
        level: 4,
        perks: [
          'Clubhouse HQ Access',
          '+10% Fishing Coins',
          '+15% Workshop Crafting Speed',
          'Exclusive Grand Trophy Room & Chandelier',
        ],
        nextLevelThreshold: null,
      };
    }
    if (balance >= 5000) {
      return {
        level: 3,
        perks: [
          'Clubhouse HQ Access',
          '+10% Fishing Coins',
          '+15% Workshop Crafting Speed',
        ],
        nextLevelThreshold: 20000,
      };
    }
    if (balance >= 1000) {
      return {
        level: 2,
        perks: ['Clubhouse HQ Access', '+10% Fishing Coins'],
        nextLevelThreshold: 5000,
      };
    }
    return {
      level: 1,
      perks: ['Clubhouse HQ Access'],
      nextLevelThreshold: 1000,
    };
  }

  /**
   * Retrieves club treasury balance, level, and active perks
   */
  static async getTreasury(clubId: string) {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new Error('Club not found');

    const redisKey = `club:treasury:${clubId}`;
    let balance = 0;
    if (redisClient.isOpen) {
      const val = await redisClient.get(redisKey);
      if (val !== null) {
        balance = parseInt(val, 10) || 0;
      }
    }

    if (balance === 0) {
      const agg = await prisma.transactionLog.aggregate({
        where: {
          type: 'CLUB_TREASURY_DEPOSIT',
          source: `club:${clubId}`,
        },
        _sum: { amount: true },
      });
      balance = agg._sum.amount || 0;
    }

    const tier = this.calculateTreasuryTier(balance);
    return {
      clubId,
      balance,
      ...tier,
    };
  }

  /**
   * Deposits HavenCoins into the club treasury
   */
  static async depositTreasury(userId: string, clubId: string, amount: number) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Deposit amount must be a positive integer');
    }

    const member = await prisma.clubMember.findUnique({ where: { userId } });
    if (!member || member.clubId !== clubId) {
      throw new Error('You are not a member of this club');
    }

    const result = await prisma.$transaction(async (tx) => {
      const club = await tx.club.findUnique({ where: { id: clubId } });
      if (!club) throw new Error('Club not found');

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.havenCoins < amount) {
        throw new Error('Insufficient HavenCoins balance');
      }

      await tx.user.update({
        where: { id: userId },
        data: { havenCoins: { decrement: amount } },
      });

      await tx.transactionLog.create({
        data: {
          senderId: userId,
          receiverId: club.ownerId,
          amount,
          type: 'CLUB_TREASURY_DEPOSIT',
          source: `club:${clubId}`,
        },
      });

      return { remainingCoins: user.havenCoins - amount, ownerId: club.ownerId };
    });

    const redisKey = `club:treasury:${clubId}`;
    let newBalance = amount;
    if (redisClient.isOpen) {
      newBalance = await redisClient.incrBy(redisKey, amount);
    } else {
      const agg = await prisma.transactionLog.aggregate({
        where: {
          type: 'CLUB_TREASURY_DEPOSIT',
          source: `club:${clubId}`,
        },
        _sum: { amount: true },
      });
      newBalance = agg._sum.amount || amount;
    }

    const tier = this.calculateTreasuryTier(newBalance);
    const payload = {
      clubId,
      depositorId: userId,
      amount,
      balance: newBalance,
      ...tier,
    };

    const io = getIO();
    if (io) {
      io.to(`club:${clubId}`).emit(SOCKET_EVENTS.CLUB_TREASURY_UPDATE, payload);
    }

    return {
      ...payload,
      userRemainingCoins: result.remainingCoins,
    };
  }

  /**
   * Updates a club member's role (promotes to OFFICER or demotes to MEMBER)
   */
  static async updateMemberRole(
    requesterId: string,
    clubId: string,
    targetUserId: string,
    newRole: ClubRole
  ) {
    if (newRole === 'OWNER') {
      throw new Error('Cannot assign OWNER role via role update');
    }

    const requester = await prisma.clubMember.findUnique({ where: { userId: requesterId } });
    if (!requester || requester.clubId !== clubId || requester.role !== 'OWNER') {
      throw new Error('Only the club Owner can modify member roles');
    }

    const target = await prisma.clubMember.findUnique({ where: { userId: targetUserId } });
    if (!target || target.clubId !== clubId) {
      throw new Error('Target user is not a member of this club');
    }

    if (target.role === 'OWNER') {
      throw new Error('Cannot change the role of the club Owner');
    }

    const updated = await prisma.clubMember.update({
      where: { userId: targetUserId },
      data: { role: newRole },
    });

    const io = getIO();
    if (io) {
      const payload = { clubId, userId: targetUserId, role: newRole };
      io.to(`club:${clubId}`).emit(SOCKET_EVENTS.CLUB_ROLE_UPDATE, payload);
      io.to(`user:${targetUserId}`).emit(SOCKET_EVENTS.CLUB_ROLE_UPDATE, payload);
    }

    return updated;
  }

  /**
   * Updates the club motto / announcement
   */
  static async setClubMotd(requesterId: string, clubId: string, motd: string) {
    const requester = await prisma.clubMember.findUnique({ where: { userId: requesterId } });
    if (!requester || requester.clubId !== clubId || requester.role === 'MEMBER') {
      throw new Error('Only club Owner or Officers can update the club MOTD');
    }

    const cleanMotd = (motd ?? '').trim().slice(0, 80);
    const updated = await prisma.club.update({
      where: { id: clubId },
      data: { motto: cleanMotd },
    });

    const io = getIO();
    if (io) {
      io.to(`club:${clubId}`).emit(SOCKET_EVENTS.CLUB_MOTD_UPDATE, { clubId, motd: cleanMotd });
    }

    return updated;
  }
}

