import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { redis } from '../redis';
import { roomManager } from '../services/RoomManager';
import { moderateMessage, checkRateLimit, clearRateLimitEntry } from '../services/ModerationService';
import { SOCKET_EVENTS } from '@havenworld/shared';
import type { PlayerState, FurnitureState, AvatarData, ChatMessage } from '@havenworld/shared';

// ── Socket authentication middleware ──────────────────────────────────────────
// Every socket connection must provide a valid JWT access token.
function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== 'string') {
    return next(new Error('AUTH_REQUIRED'));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
      userId: string;
      username: string;
      role: string;
    };
    socket.data.user = payload;
    next();
  } catch {
    next(new Error('AUTH_INVALID'));
  }
}

// Move rate limiter (separate from chat — higher frequency)
const moveRateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkMoveRateLimit(socketId: string): boolean {
  const now = Date.now();
  const rec = moveRateLimiter.get(socketId) ?? { count: 0, resetAt: now + 1000 };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + 1000;
  }
  rec.count += 1;
  moveRateLimiter.set(socketId, rec);
  return rec.count <= 20; // max 20 position updates per second
}

let ioInstance: Server | null = null;
export function getIO(): Server | null {
  return ioInstance;
}

export function registerSocketHandlers(io: Server): void {
  ioInstance = io;
  io.use(socketAuthMiddleware);

  io.on('connection', (socket: Socket) => {
    const { userId, username } = socket.data.user as {
      userId: string;
      username: string;
      role: string;
    };
    console.log(`[Socket] Connected: ${username} (${socket.id})`);

    // ── auth:join ─────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.AUTH_JOIN, async ({ roomId }: { roomId: string }) => {
      try {
        // Check ban status
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { status: true, mutedUntil: true },
        });

        if (dbUser?.status === 'BANNED') {
          socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
            code: 'BANNED',
            message: 'Your account has been suspended.',
          });
          socket.disconnect(true);
          return;
        }

        // Load avatar from DB
        const avatar = await prisma.avatar.findUnique({ where: { userId } });
        if (!avatar) {
          socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
            code: 'NO_AVATAR',
            message: 'Avatar not found.',
          });
          return;
        }

        const avatarData: AvatarData = {
          bodyType: avatar.bodyType,
          skinTone: avatar.skinTone,
          hairStyle: avatar.hairStyle,
          hairColor: avatar.hairColor,
          eyeStyle: avatar.eyeStyle,
          eyeColor: avatar.eyeColor,
          outfitHead: avatar.outfitHead,
          outfitFace: avatar.outfitFace,
          outfitBody: avatar.outfitBody,
          outfitLegs: avatar.outfitLegs,
          outfitFeet: avatar.outfitFeet,
          outfitBack: avatar.outfitBack,
          outfitHand: avatar.outfitHand,
        };

        // Load furniture from DB if not already cached in RoomManager
        if (!roomManager.isFurnitureLoaded(roomId)) {
          const dbFurniture = await prisma.roomFurniture.findMany({
            where: { roomId },
            include: { item: true },
            orderBy: { layer: 'asc' },
          });

          const furniture: FurnitureState[] = dbFurniture.map((f) => ({
            id: f.id,
            itemId: f.itemId,
            spriteKey: f.item.spriteKey,
            x: f.x,
            y: f.y,
            z: f.z,
            rotation: f.rotation,
            layer: f.layer,
            type: f.item.spriteKey,
            depth: f.y,
            ownerId: f.placedBy,
          }));
          roomManager.setFurniture(roomId, furniture);
        }

        // Build spawn position — center of the room
        const dbRoom = await prisma.room.findUnique({
          where: { id: roomId },
          select: { width: true, height: true, name: true },
        });
        const spawnX = Math.floor((dbRoom?.width ?? 20) / 2) * 32;
        const spawnY = Math.floor((dbRoom?.height ?? 15) / 2) * 32;

        const player: PlayerState = {
          id: userId,
          username,
          avatar: avatarData,
          x: 0,
          y: 0,
          z: 0,
          rotY: 0,
          direction: 'down',
          isMoving: false,
          roomId,
        };

        // Clean up previous room if switching rooms on the same socket
        const prev = roomManager.leaveRoom(socket.id);
        if (prev && prev.roomId !== roomId) {
          socket.leave(prev.roomId);
          socket.to(prev.roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
            playerId: prev.playerId,
          });
        }

        // Join the Socket.io room and register in RoomManager
        socket.join(roomId);
        roomManager.joinRoom(roomId, socket.id, player);

        // Track online status in Redis
        await redis.sAdd('online_users', userId);

        // Send full room state to the joining player only
        const roomState = roomManager.getRoomState(roomId)!;
        socket.emit(SOCKET_EVENTS.ROOM_STATE, {
          roomId,
          roomName: dbRoom?.name ?? roomId,
          players: Array.from(roomState.players.values()),
          furniture: roomState.furniture,
          chatHistory: roomState.chatHistory,
        });

        // Notify all OTHER players in the room that someone new joined
        socket.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, player);
        socket.to(roomId).emit('player:join', {
          userId,
          username,
          position: { x: player.x, y: player.y, z: player.z ?? 0, rotY: player.rotY ?? 0 },
          avatarData,
        });

        // Notify online friends
        const friendships = await prisma.friend.findMany({
          where: {
            OR: [{ requesterId: userId }, { addresseeId: userId }],
            status: 'ACCEPTED',
          },
        });
        const friendIds = friendships.map((f) =>
          f.requesterId === userId ? f.addresseeId : f.requesterId
        );

        if (friendIds.length > 0) {
          const allSockets = await io.fetchSockets();
          for (const friendId of friendIds) {
            const friendSocket = allSockets.find(
              (s) => s.data.user?.userId === friendId
            );
            friendSocket?.emit(SOCKET_EVENTS.FRIEND_ONLINE, {
              userId,
              username,
            });
          }
        }
      } catch (err) {
        console.error('[Socket] auth:join error:', err);
        socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
          code: 'SERVER_ERROR',
          message: 'Failed to join room.',
        });
      }
    });

    // ── player:move ───────────────────────────────────────────────────────────
    socket.on(
      SOCKET_EVENTS.PLAYER_MOVE,
      (data: {
        x: number;
        y: number;
        z?: number;
        rotY?: number;
        direction?: string;
        roomId: string;
        isMoving?: boolean;
      }) => {
        // Rate limit: max 20 position updates per second
        if (!checkMoveRateLimit(socket.id)) return;

        // Verify socket is actually in the claimed room
        const currentRoom = roomManager.getPlayerRoom(socket.id);
        if (currentRoom !== data.roomId) return;

        // Basic server-side sanity clamp (prevent teleport exploits)
        const MAX_COORD = 200;
        const cx = Math.max(-MAX_COORD, Math.min(MAX_COORD, data.x));
        const cy = Math.max(0, Math.min(10, data.y ?? 0));
        const cz = Math.max(-MAX_COORD, Math.min(MAX_COORD, data.z ?? 0));
        const cRotY = (data.rotY ?? 0) % (Math.PI * 2);

        // Update in-memory state
        roomManager.movePlayer(
          socket.id,
          cx,
          cy,
          data.direction ?? 'down',
          data.isMoving ?? false,
          cz,
          cRotY
        );

        // Broadcast to everyone else in the room (legacy & Phase 2 event)
        const movePayload = {
          playerId: userId,
          userId,
          x: cx,
          y: cy,
          z: cz,
          rotY: cRotY,
          direction: data.direction ?? 'down',
          isMoving: data.isMoving ?? false,
        };
        socket.to(data.roomId).emit(SOCKET_EVENTS.PLAYER_POSITION, movePayload);
        socket.to(data.roomId).emit('player:move', movePayload);
      }
    );

    // ── chat:send ─────────────────────────────────────────────────────────────
    socket.on(
      SOCKET_EVENTS.CHAT_SEND,
      async (data: { content: string; roomId?: string }) => {
        // Rate limit: 5 messages per 3 seconds
        if (!checkRateLimit(socket.id, 5, 3000)) {
          socket.emit(SOCKET_EVENTS.CHAT_ERROR, {
            code: 'RATE_LIMITED',
            message: 'Please slow down!',
          });
          return;
        }

        const content = data.content?.trim();
        if (!content || content.length === 0 || content.length > 200) return;

        // Check mute status
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { status: true, mutedUntil: true },
        });

        if (dbUser?.status === 'MUTED') {
          const stillMuted =
            !dbUser.mutedUntil || new Date() < dbUser.mutedUntil;
          if (stillMuted) {
            socket.emit(SOCKET_EVENTS.CHAT_ERROR, {
              code: 'MUTED',
              message: 'You are currently muted.',
            });
            return;
          }
          // Auto-unmute if mute period has expired
          await prisma.user.update({
            where: { id: userId },
            data: { status: 'ACTIVE', mutedUntil: null },
          });
        }

        const roomId = data.roomId ?? roomManager.getPlayerRoom(socket.id);
        if (!roomId) return;

        // Run through profanity filter
        const { filtered, wasFiltered } = moderateMessage(content);

        // Persist to database for audit log
        const saved = await prisma.chatMessage.create({
          data: {
            roomId,
            senderId: userId,
            content: filtered,
            isFiltered: wasFiltered,
          },
        });

        const message: ChatMessage = {
          id: saved.id,
          senderId: userId,
          senderName: username,
          playerId: userId,
          username,
          text: filtered,
          content: filtered,
          isFiltered: wasFiltered,
          timestamp: saved.createdAt.toISOString(),
          roomId,
        };

        // Add to in-memory chat history (last 50)
        roomManager.addChatMessage(roomId, message);

        // Broadcast to ALL players in the room INCLUDING sender
        io.to(roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
      }
    );

    // ── avatar:update ─────────────────────────────────────────────────────────
    socket.on(
      SOCKET_EVENTS.AVATAR_UPDATE,
      async (avatarData: Record<string, string | null>) => {
        try {
          const itemFields = [
            'outfitHead',
            'outfitFace',
            'outfitBody',
            'outfitLegs',
            'outfitFeet',
            'outfitBack',
            'outfitHand',
          ];
          const requestedItemIds = itemFields
            .map((f) => avatarData[f])
            .filter((v): v is string => typeof v === 'string');

          // Verify items exist in inventory
          if (requestedItemIds.length > 0) {
            const count = await prisma.inventory.count({
              where: {
                userId,
                itemId: { in: requestedItemIds },
              },
            });
            if (count !== requestedItemIds.length) {
              socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
                code: 'INVALID_ITEMS',
                message: 'One or more items are not in your inventory.',
              });
              return;
            }
          }

          // Save new avatar config to database
          await prisma.avatar.update({
            where: { userId },
            data: {
              skinTone: avatarData.skinTone ?? undefined,
              hairStyle: avatarData.hairStyle ?? undefined,
              hairColor: avatarData.hairColor ?? undefined,
              eyeStyle: avatarData.eyeStyle ?? undefined,
              outfitHead: avatarData.outfitHead,
              outfitFace: avatarData.outfitFace,
              outfitBody: avatarData.outfitBody,
              outfitLegs: avatarData.outfitLegs,
              outfitFeet: avatarData.outfitFeet,
              outfitBack: avatarData.outfitBack,
              outfitHand: avatarData.outfitHand,
            },
          });

          // Update in-memory player state
          const roomId = roomManager.getPlayerRoom(socket.id);
          if (roomId) {
            const playerState = roomManager
              .getRoomState(roomId)
              ?.players.get(socket.id);
            if (playerState) {
              Object.assign(playerState.avatar, avatarData);
            }
            // Broadcast to others
            socket.to(roomId).emit(SOCKET_EVENTS.AVATAR_CHANGED, {
              playerId: userId,
              avatar: avatarData,
            });
          }
        } catch (err) {
          console.error('[Socket] avatar:update error:', err);
        }
      }
    );

    // ── furniture:place (Part 5B) ─────────────────────────────────────────────
    socket.on(
      SOCKET_EVENTS.FURNITURE_PLACE,
      async (data: {
        roomId: string;
        placement: {
          itemId: string;
          x: number;
          y: number;
          z: number;
          rotY?: number;
          scaleX?: number;
          scaleY?: number;
          scaleZ?: number;
        };
      }) => {
        try {
          const { roomId, placement } = data;
          const room = await prisma.room.findUnique({ where: { id: roomId } });
          if (!room || room.ownerId !== userId) {
            socket.emit('error', { message: 'Not authorized to place furniture in this room' });
            return;
          }

          const created = await prisma.roomFurniture.create({
            data: {
              roomId,
              itemId: placement.itemId,
              placedBy: userId,
              x: placement.x,
              y: placement.y,
              z: placement.z ?? 0,
              rotation: placement.rotY ?? 0,
              scaleX: placement.scaleX ?? 1,
              scaleY: placement.scaleY ?? 1,
              scaleZ: placement.scaleZ ?? 1,
            },
            include: { item: true },
          });

          io.to(roomId).emit(SOCKET_EVENTS.ROOM_FURNITURE_UPDATED, {
            roomId,
            action: 'place',
            item: created,
          });
        } catch (err) {
          console.error('[Socket] furniture:place error:', err);
        }
      }
    );

    // ── furniture:remove (Part 5B) ────────────────────────────────────────────
    socket.on(
      SOCKET_EVENTS.FURNITURE_REMOVE,
      async (data: { roomId: string; furnitureId: string }) => {
        try {
          const { roomId, furnitureId } = data;
          const item = await prisma.roomFurniture.findUnique({
            where: { id: furnitureId },
          });
          if (!item || item.placedBy !== userId) {
            socket.emit('error', { message: 'Not authorized to remove this item' });
            return;
          }

          await prisma.roomFurniture.delete({ where: { id: furnitureId } });
          io.to(roomId).emit(SOCKET_EVENTS.ROOM_FURNITURE_UPDATED, {
            roomId,
            action: 'remove',
            furnitureId,
          });
        } catch (err) {
          console.error('[Socket] furniture:remove error:', err);
        }
      }
    );

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Disconnected: ${username} (${reason})`);

      const left = roomManager.leaveRoom(socket.id);
      if (left) {
        io.to(left.roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
          playerId: left.playerId,
        });
      }

      await redis.sRem('online_users', userId).catch(() => {});

      await prisma.user
        .update({
          where: { id: userId },
          data: { lastLoginAt: new Date() },
        })
        .catch(() => {});

      try {
        const friendships = await prisma.friend.findMany({
          where: {
            OR: [{ requesterId: userId }, { addresseeId: userId }],
            status: 'ACCEPTED',
          },
        });
        const friendIds = friendships.map((f) =>
          f.requesterId === userId ? f.addresseeId : f.requesterId
        );

        if (friendIds.length > 0) {
          const allSockets = await io.fetchSockets();
          for (const friendId of friendIds) {
            const friendSocket = allSockets.find(
              (s) => s.data.user?.userId === friendId
            );
            friendSocket?.emit(SOCKET_EVENTS.FRIEND_OFFLINE, {
              userId,
              username,
            });
          }
        }
      } catch {
        /* non-critical */
      }

      clearRateLimitEntry(socket.id);
      moveRateLimiter.delete(socket.id);
    });
  });
}
