import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import { redisClient } from '../redis';
import { getIO } from '../sockets';
import { SOCKET_EVENTS, RoomPrivacyMode } from '@havenworld/shared';
import { AchievementService } from './AchievementService';

export class PrivacyManager {
  /**
   * Checks whether a user has permission to enter a room
   */
  static async checkAccess(userId: string, roomId: string, passwordInput?: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        decorators: true,
      },
    });

    if (!room) return { allowed: false, reason: 'ROOM_NOT_FOUND' };

    // Owner always has access
    if (room.ownerId === userId) return { allowed: true, mode: room.privacy };

    // Public rooms admit everyone
    if (room.privacy === 'PUBLIC') return { allowed: true, mode: 'PUBLIC' };

    // Locked rooms allow nobody except owner
    if (room.privacy === 'LOCKED') {
      return {
        allowed: false,
        reason: 'ROOM_LOCKED',
        awayMessage: room.awayMessage || 'The owner has locked this room.',
      };
    }

    // Friends-Only check
    if (room.privacy === 'FRIENDS_ONLY') {
      if (!room.ownerId) return { allowed: false, reason: 'FRIENDS_ONLY' };

      const friendship = await prisma.friend.findFirst({
        where: {
          OR: [
            { requesterId: userId, addresseeId: room.ownerId },
            { requesterId: room.ownerId, addresseeId: userId },
          ],
          status: 'ACCEPTED',
        },
      });

      if (!friendship) {
        return {
          allowed: false,
          reason: 'FRIENDS_ONLY',
          awayMessage: room.awayMessage || 'This loft is open to friends only.',
        };
      }
      return { allowed: true, mode: 'FRIENDS_ONLY' };
    }

    // Password-Protected check
    if (room.privacy === 'PASSWORD_PROTECTED') {
      if (!passwordInput || !room.passwordHash) {
        return { allowed: false, reason: 'PASSWORD_REQUIRED' };
      }

      const match = await bcrypt.compare(passwordInput, room.passwordHash);
      if (!match) {
        return { allowed: false, reason: 'PASSWORD_INCORRECT' };
      }
      return { allowed: true, mode: 'PASSWORD_PROTECTED' };
    }

    return { allowed: false, reason: 'ACCESS_DENIED' };
  }

  /**
   * Sets the privacy mode and optional password for a room
   */
  static async setRoomPrivacy(
    ownerId: string,
    roomId: string,
    mode: RoomPrivacyMode,
    password?: string,
    awayMessage?: string
  ) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== ownerId) {
      throw new Error('Unauthorized to modify room privacy');
    }

    let passwordHash = room.passwordHash;
    if (mode === 'PASSWORD_PROTECTED' && password) {
      if (password.length < 4 || password.length > 16) {
        throw new Error('Password must be between 4 and 16 characters');
      }
      passwordHash = await bcrypt.hash(password, 10);
    }

    const updated = await prisma.room.update({
      where: { id: roomId },
      data: {
        privacy: mode,
        passwordHash: mode === 'PASSWORD_PROTECTED' ? passwordHash : null,
        awayMessage: awayMessage ? awayMessage.slice(0, 80) : room.awayMessage,
      },
    });

    const io = getIO();
    if (io) {
      io.to(`room:${roomId}`).emit(SOCKET_EVENTS.PRIVACY_UPDATED, {
        roomId,
        mode,
      });
    }

    return updated;
  }

  /**
   * Handles a visitor knocking at the doorbell
   */
  static async ringDoorbell(visitorId: string, roomId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { ownerId: true, name: true, awayMessage: true },
    });

    if (!room || !room.ownerId) {
      throw new Error('Room or owner not found');
    }

    const visitor = await prisma.user.findUnique({
      where: { id: visitorId },
      include: { avatar: true },
    });

    if (!visitor) throw new Error('Visitor not found');

    // Store knock with 120-second TTL in Redis
    const knockKey = `knock:${roomId}:${visitorId}`;
    if (redisClient.isOpen) {
      await redisClient.set(knockKey, 'pending', { EX: 120 });
    }

    // Notify room owner
    const io = getIO();
    if (io) {
      io.to(`user:${room.ownerId}`).emit(SOCKET_EVENTS.DOORBELL_RING, {
        visitorId,
        visitorName: visitor.username,
        avatar: visitor.avatar,
        roomId,
      });
    }

    return { sent: true, awayMessage: room.awayMessage };
  }

  /**
   * Handles owner's decision on a doorbell knock
   */
  static async decideDoorbell(ownerId: string, visitorId: string, roomId: string, admit: boolean) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== ownerId) {
      throw new Error('Unauthorized to decide on room doorbell');
    }

    const knockKey = `knock:${roomId}:${visitorId}`;
    if (redisClient.isOpen) {
      await redisClient.del(knockKey);
    }

    if (admit) {
      // Record in access log
      await prisma.roomAccessLog.create({
        data: {
          roomId,
          visitorId,
        },
      });

      await AchievementService.checkAndAward(ownerId, 'DOORBELL_ADMIT');
    }

    const io = getIO();
    if (io) {
      io.to(`user:${visitorId}`).emit(SOCKET_EVENTS.DOORBELL_RESULT, {
        admitted: admit,
        roomId,
        message: admit ? 'Welcome to the loft!' : 'The owner is busy.',
      });
    }

    return { success: true, admitted: admit };
  }

  /**
   * Grant decorator rights to a friend (up to 3 per loft)
   */
  static async grantDecorator(ownerId: string, roomId: string, targetUserId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { decorators: true },
    });

    if (!room || room.ownerId !== ownerId) throw new Error('Unauthorized');
    if (room.decorators.length >= 3) throw new Error('Maximum 3 decorators allowed per loft');

    return await prisma.roomDecorator.create({
      data: {
        roomId,
        userId: targetUserId,
      },
    });
  }

  /**
   * Revoke decorator rights
   */
  static async revokeDecorator(ownerId: string, roomId: string, targetUserId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.ownerId !== ownerId) throw new Error('Unauthorized');

    return await prisma.roomDecorator.deleteMany({
      where: { roomId, userId: targetUserId },
    });
  }
}
