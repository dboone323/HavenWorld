import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { redis } from '../redis';
import { roomManager } from '../services/RoomManager';
import { moderateMessage, checkRateLimit, clearRateLimitEntry } from '../services/ModerationService';
import { SOCKET_EVENTS } from '@havenworld/shared';
import type { PlayerState, FurnitureState, AvatarData, ChatMessage } from '@havenworld/shared';
import {
  JoinRoomSchema, MoveSchema, ChatSchema,
  FurniturePlaceSchema, FurnitureRemoveSchema,
  CastLineSchema, ReelPositionSchema,
  SetPrivacySchema, DoorbellSchema, DoorbellDecisionSchema, GrantDecoratorSchema,
  GuestbookSignSchema, TipSchema, GetGuestbookSchema, DeleteGuestbookEntrySchema,
  TradeRequestSchema, OfferItemSchema, OfferCoinsSchema,
  AdoptPetSchema, NamePetSchema, FeedPetSchema,
  PizzaOrderSchema, RecycleItemSchema, StartCraftSchema, ClaimCraftSchema,
  SetMoodSchema, EmoteSchema, ClubChatSchema,
} from './socketSchemas';
import { FishingService } from '../services/FishingService';
import { PrivacyManager } from '../services/PrivacyManager';
import { GuestbookService } from '../services/GuestbookService';
import { TradeManager } from '../services/TradeManager';
import { PetManager } from '../services/PetManager';
import { MinigameService } from '../services/MinigameService';
import { WorkshopService } from '../services/WorkshopService';
import { ClubService } from '../services/ClubService';
import { QuestService } from '../services/QuestService';
import { AchievementService } from '../services/AchievementService';
import { ALLOWED_ORIGINS } from '../middleware/security';
import { attachIdleTimeout } from './idleTimeout';
import { SocketRateLimiter } from './rateLimiter';
import { MovementValidator } from '../game/movement';
import { captureSecurityEvent } from '../monitoring/sentry';

// ── CSWSH Origin Check Middleware ───────────────────────────────────────────
function socketOriginMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const origin = socket.handshake.headers.origin;
  if (!origin && process.env.NODE_ENV !== 'production') {
    return next();
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return next();
  }
  next(new Error('ORIGIN_FORBIDDEN'));
}

// ── Socket authentication middleware ──────────────────────────────────────────
// Every socket connection must provide a valid JWT access token with HS256 pinning.
async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== 'string') {
    return next(new Error('AUTH_REQUIRED'));
  }
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    return next(new Error('AUTH_CONFIG_ERROR'));
  }
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as {
      userId: string;
      username: string;
      role: string;
    };

    // Check if user is banned
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { isBanned: true, status: true },
    });
    if (dbUser?.isBanned || dbUser?.status === 'BANNED') {
      return next(new Error('USER_BANNED'));
    }

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
  io.use(socketOriginMiddleware);
  io.use(socketAuthMiddleware);

  io.on('connection', (socket: Socket) => {
    const { userId, username } = socket.data.user as {
      userId: string;
      username: string;
      role: string;
    };
    console.log(`[Socket] Connected: ${username} (${socket.id})`);
    socket.join(`user:${userId}`);

    // Attach 10-minute idle timeout
    attachIdleTimeout(socket);

    // Global rate limiting tracker
    socket.onAny((eventName) => {
      if (eventName === 'disconnect') return;
      SocketRateLimiter.checkLimit(socket, eventName);
    });

    // ── auth:join ─────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.AUTH_JOIN, async (rawData: unknown) => {
      const parsed = JoinRoomSchema.safeParse(rawData);
      if (!parsed.success) {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
        return;
      }
      const { roomId } = parsed.data;
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

        // Build spawn position and verify room access
        const dbRoom = await prisma.room.findUnique({
          where: { id: roomId },
          select: { width: true, height: true, name: true, accessMode: true, ownerId: true },
        });

        if (!dbRoom) {
          socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
            code: 'ROOM_NOT_FOUND',
            message: 'Room does not exist.',
          });
          return;
        }

        if (dbRoom.accessMode === 'PRIVATE' && dbRoom.ownerId !== userId) {
          const access = await prisma.loftAccess.findUnique({
            where: {
              roomId_userId: { roomId, userId },
            },
          });
          if (!access) {
            socket.emit(SOCKET_EVENTS.AUTH_ERROR, {
              code: 'FORBIDDEN_PRIVATE_LOFT',
              message: 'This personal loft is private.',
            });
            return;
          }
        }

        const spawnX = Math.floor((dbRoom?.width ?? 20) / 2) * 32;
        const spawnY = Math.floor((dbRoom?.height ?? 15) / 2) * 32;

        MovementValidator.initializePlayer(userId, { x: spawnX, y: spawnY, z: 0 });

        const player: PlayerState = {
          id: userId,
          username,
          avatar: avatarData,
          x: spawnX,
          y: spawnY,
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
      (rawData: unknown) => {
        const parsed = MoveSchema.safeParse(rawData);
        if (!parsed.success) return; // silently drop malformed move packets
        const data = parsed.data;
        // Rate limit: max 20 position updates per second
        if (!checkMoveRateLimit(socket.id)) return;

        // Verify socket is actually in the claimed room
        const currentRoom = roomManager.getPlayerRoom(socket.id);
        if (currentRoom !== data.roomId) return;

        // Server-authoritative movement validation & speed-hack detection
        const moveCheck = MovementValidator.validateMovement(userId, {
          x: data.x,
          y: data.y,
          z: data.z,
        });

        if (!moveCheck.valid) {
          captureSecurityEvent('SPEED_HACK_DETECTED', {
            userId,
            socketId: socket.id,
            violations: moveCheck.violations,
            details: moveCheck.reason,
          });

          // Send snapback correction to client
          socket.emit(SOCKET_EVENTS.POSITION_CORRECTION, {
            x: moveCheck.correctedPosition.x,
            y: moveCheck.correctedPosition.y,
            z: moveCheck.correctedPosition.z,
          });

          if (moveCheck.violations >= 3) {
            socket.emit(SOCKET_EVENTS.ERROR, {
              code: 'SPEED_HACK_DISCONNECT',
              message: 'Disconnected due to repeated suspicious movement speed.',
            });
            socket.disconnect(true);
          }
          return;
        }

        const cx = moveCheck.correctedPosition.x;
        const cy = moveCheck.correctedPosition.y;
        const cz = moveCheck.correctedPosition.z ?? 0;
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
      async (rawData: unknown) => {
        const parsed = ChatSchema.safeParse(rawData);
        if (!parsed.success) {
          socket.emit(SOCKET_EVENTS.CHAT_ERROR, { code: 'INVALID_PAYLOAD' });
          return;
        }
        const data = parsed.data;
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
      async (rawData: unknown) => {
        const parsed = FurniturePlaceSchema.safeParse(rawData);
        if (!parsed.success) {
          socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_PAYLOAD' });
          return;
        }
        const { roomId, placement } = parsed.data;
        try {
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
      async (rawData: unknown) => {
        const parsed = FurnitureRemoveSchema.safeParse(rawData);
        if (!parsed.success) {
          socket.emit(SOCKET_EVENTS.ERROR, { code: 'INVALID_PAYLOAD' });
          return;
        }
        const { roomId, furnitureId } = parsed.data;
        try {
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

    // ── Phase 3: Fishing Mini-Game (§1) ──────────────────────────────────────
    socket.on(SOCKET_EVENTS.CAST_LINE, (rawData: unknown) => {
      const parsed = CastLineSchema.safeParse(rawData);
      if (!parsed.success) return;
      FishingService.startSession(userId, parsed.data.roomId);
    });

    socket.on(SOCKET_EVENTS.REEL_POSITION, (rawData: unknown) => {
      const parsed = ReelPositionSchema.safeParse(rawData);
      if (!parsed.success) return;
      FishingService.updateReelPosition(userId, parsed.data.value);
    });

    socket.on(SOCKET_EVENTS.CANCEL_FISHING, () => {
      FishingService.cancelSession(userId);
    });

    // ── Phase 3: Loft Privacy & Doorbell (§2) ────────────────────────────────
    socket.on(SOCKET_EVENTS.RING_DOORBELL, async (rawData: unknown) => {
      const parsed = DoorbellSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PrivacyManager.ringDoorbell(userId, parsed.data.roomId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Doorbell error' });
      }
    });

    socket.on(SOCKET_EVENTS.DOORBELL_DECISION, async (rawData: unknown) => {
      const parsed = DoorbellDecisionSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PrivacyManager.decideDoorbell(userId, parsed.data.visitorId, parsed.data.roomId, parsed.data.admit);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Doorbell decision error' });
      }
    });

    socket.on(SOCKET_EVENTS.SET_ROOM_PRIVACY, async (rawData: unknown) => {
      const parsed = SetPrivacySchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PrivacyManager.setRoomPrivacy(userId, parsed.data.roomId, parsed.data.mode, parsed.data.password, parsed.data.awayMessage);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Privacy error' });
      }
    });

    socket.on(SOCKET_EVENTS.GRANT_DECORATOR, async (rawData: unknown) => {
      const parsed = GrantDecoratorSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PrivacyManager.grantDecorator(userId, parsed.data.roomId, parsed.data.targetUserId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Decorator grant error' });
      }
    });

    socket.on(SOCKET_EVENTS.REVOKE_DECORATOR, async (rawData: unknown) => {
      const parsed = GrantDecoratorSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PrivacyManager.revokeDecorator(userId, parsed.data.roomId, parsed.data.targetUserId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Decorator revoke error' });
      }
    });

    // ── Phase 3: Guestbook & Tip Jar (§3) ────────────────────────────────────
    socket.on(SOCKET_EVENTS.SIGN_GUESTBOOK, async (rawData: unknown) => {
      const parsed = GuestbookSignSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await GuestbookService.signBook(parsed.data.roomId, userId, parsed.data.message);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Guestbook error' });
      }
    });

    socket.on(SOCKET_EVENTS.TIP_OWNER, async (rawData: unknown) => {
      const parsed = TipSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit(SOCKET_EVENTS.TIP_ERROR, { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await GuestbookService.tipOwner(userId, parsed.data.roomId, parsed.data.amount);
      } catch (err: any) {
        socket.emit(SOCKET_EVENTS.TIP_ERROR, { message: err?.message || 'Tip error' });
      }
    });

    socket.on(SOCKET_EVENTS.GET_GUESTBOOK, async (rawData: unknown) => {
      const parsed = GetGuestbookSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        const pageData = await GuestbookService.getPage(parsed.data.roomId, parsed.data.page);
        socket.emit(SOCKET_EVENTS.GUESTBOOK_PAGE, pageData);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Failed to load guestbook' });
      }
    });

    socket.on(SOCKET_EVENTS.DELETE_GUESTBOOK_ENTRY, async (rawData: unknown) => {
      const parsed = DeleteGuestbookEntrySchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await GuestbookService.deleteEntry(parsed.data.entryId, userId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Delete error' });
      }
    });

    // ── Phase 3: Anti-Scam P2P Trading (§5) ──────────────────────────────────
    socket.on(SOCKET_EVENTS.TRADE_REQUEST, (rawData: unknown) => {
      const parsed = TradeRequestSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        TradeManager.requestTrade(userId, parsed.data.targetUserId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Trade request error' });
      }
    });

    socket.on(SOCKET_EVENTS.TRADE_ACCEPT, () => {
      TradeManager.acceptTrade(userId);
    });

    socket.on(SOCKET_EVENTS.TRADE_DECLINE, () => {
      TradeManager.cancelTrade(userId, 'Trade declined');
    });

    socket.on(SOCKET_EVENTS.OFFER_ITEM, (rawData: unknown) => {
      const parsed = OfferItemSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      TradeManager.offerItem(userId, parsed.data.slotIndex, parsed.data.inventoryItemId, parsed.data.name, parsed.data.assetUrl);
    });

    socket.on(SOCKET_EVENTS.OFFER_COINS, (rawData: unknown) => {
      const parsed = OfferCoinsSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      TradeManager.offerCoins(userId, parsed.data.amount);
    });

    socket.on(SOCKET_EVENTS.TRADE_READY, () => {
      TradeManager.setReady(userId);
    });

    socket.on(SOCKET_EVENTS.TRADE_CONFIRM, async () => {
      await TradeManager.confirmTrade(userId);
    });

    socket.on(SOCKET_EVENTS.TRADE_CANCEL, () => {
      TradeManager.cancelTrade(userId, 'Trade cancelled by player');
    });

    // ── Phase 3: Pet Companions (§7) ─────────────────────────────────────────
    socket.on(SOCKET_EVENTS.ADOPT_PET, async (rawData: unknown) => {
      const parsed = AdoptPetSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PetManager.adoptPet(userId, parsed.data.petType, parsed.data.name);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Pet adoption error' });
      }
    });

    socket.on(SOCKET_EVENTS.NAME_PET, async (rawData: unknown) => {
      const parsed = NamePetSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PetManager.namePet(userId, parsed.data.petId, parsed.data.name);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Pet rename error' });
      }
    });

    socket.on(SOCKET_EVENTS.FEED_PET, async (rawData: unknown) => {
      const parsed = FeedPetSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await PetManager.feedPet(userId, parsed.data.petId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Pet feeding error' });
      }
    });

    // ── Phase 3: Pizza Chef Mini-Game (§8) ───────────────────────────────────
    socket.on(SOCKET_EVENTS.PIZZA_ORDER_SUBMIT, async (rawData: unknown) => {
      const parsed = PizzaOrderSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        const result = await MinigameService.submitPizzaOrder(userId, parsed.data);
        socket.emit(SOCKET_EVENTS.PIZZA_ORDER_RESULT, result);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Pizza submission error' });
      }
    });

    // ── Phase 3: Workshop Crafting & Recycling (§9) ──────────────────────────
    socket.on(SOCKET_EVENTS.RECYCLE_ITEM, async (rawData: unknown) => {
      const parsed = RecycleItemSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await WorkshopService.recycleItem(userId, parsed.data.inventoryItemId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Recycling error' });
      }
    });

    socket.on(SOCKET_EVENTS.START_CRAFT, async (rawData: unknown) => {
      const parsed = StartCraftSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await WorkshopService.startCraft(userId, parsed.data.recipeId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Crafting start error' });
      }
    });

    socket.on(SOCKET_EVENTS.CLAIM_CRAFT, async (rawData: unknown) => {
      const parsed = ClaimCraftSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await WorkshopService.claimCraft(userId, parsed.data.craftingQueueId);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Claim craft error' });
      }
    });

    // ── Phase 3: Loft Ambient Moods (§11) ────────────────────────────────────
    socket.on(SOCKET_EVENTS.SET_ROOM_MOOD, async (rawData: unknown) => {
      const parsed = SetMoodSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        const room = await prisma.room.findUnique({ where: { id: parsed.data.roomId } });
        if (!room || room.ownerId !== userId) return;

        await prisma.room.update({
          where: { id: parsed.data.roomId },
          data: { moodPreset: parsed.data.mood },
        });

        io.to(`room:${parsed.data.roomId}`).emit(SOCKET_EVENTS.ROOM_MOOD_CHANGED, {
          roomId: parsed.data.roomId,
          mood: parsed.data.mood,
        });

        await QuestService.incrementProgress(userId, 'CHANGE_MOOD', 1);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Mood change error' });
      }
    });

    // ── Phase 3: Emote Wheel (§14) ───────────────────────────────────────────
    socket.on(SOCKET_EVENTS.EMOTE_TRIGGERED, (rawData: unknown) => {
      const parsed = EmoteSchema.safeParse(rawData);
      if (!parsed.success) return;
      const p = roomManager.getPlayer(userId);
      if (p?.roomId) {
        io.to(`room:${p.roomId}`).emit(SOCKET_EVENTS.AVATAR_EMOTE, {
          userId,
          emoteId: parsed.data.emoteId,
        });
      }
    });

    // ── Phase 3: Club Chat (§13) ─────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.CLUB_CHAT_SEND, async (rawData: unknown) => {
      const parsed = ClubChatSchema.safeParse(rawData);
      if (!parsed.success) { socket.emit('error', { code: 'INVALID_PAYLOAD' }); return; }
      try {
        await ClubService.sendClubMessage(userId, parsed.data.clubId, parsed.data.content);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Club message error' });
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Disconnected: ${username} (${reason})`);

      FishingService.cancelSession(userId);
      TradeManager.cancelTrade(userId, 'Player disconnected');

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
      MovementValidator.removePlayer(userId);
      SocketRateLimiter.cleanup(socket.id);
    });
  });
}
