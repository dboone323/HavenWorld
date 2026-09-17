import { handleIdentity, awardIdentity } from './identity.ts';
import type { IdentityState } from '../shared/types.ts';

/**
 * HavenWorld — WebSocket message dispatcher (TypeScript).
 * Maps a client message { type, payload } to room-state mutations and
 * outbound events. db calls are self-noops in memory mode.
 */
import { calculateFacing } from '../shared/movement.ts';
import { validateMoveRequest, needsReconcile, RECONCILE_EPSILON } from '../shared/authority.ts';
import { isWithinAudibleDistance, DEFAULT_AUDIBLE_RADIUS, DEFAULT_SHOUT_RADIUS } from '../shared/spatial.ts';
import { ShardManager } from './sharding.ts';
import { parseCommand, moderateChat } from './moderation.ts';
import { serializePlayer, serializeRoom, RoomManager, getUserLoftRoomId } from './rooms.ts';
import { TradeManager } from './trade.ts';
import { CATALOG_ITEMS, getRotatingFeaturedStock, getTimeUntilNextRotation } from '../shared/catalog.ts';
import { calculateSalvageYield, canCraftRecipe, deductCraftingMaterials } from '../shared/crafting.ts';
import { petInteract } from '../shared/pet.ts';
import type { Player } from './rooms.ts';
import type { PlacedFurniture, Avatar, ShopItem, InventoryItem, FriendEntry, PendingRequest, MessageRecord } from '../shared/types.ts';
import type { WebSocket } from 'ws';

export const shardManager = new ShardManager();

export interface DispatchContext {
  rooms: RoomManager;
  db: {
    loadIdentity?: (userId: string) => Promise<IdentityState>;
    saveIdentity?: (userId: string, identity: IdentityState) => Promise<void>;
    getMode: () => string;
    initPlayerProfile: (userId: string, username: string) => Promise<void>;
    saveAvatar: (userId: string, avatar: Avatar) => Promise<void>;
    addCoins: (userId: string, amount: number) => Promise<void>;
    addGems?: (userId: string, amount: number) => Promise<number>;
    getRoomFurniture: (roomId: string) => Promise<PlacedFurniture[] | null>;
    getLoftFurniture: (roomId: string) => Promise<PlacedFurniture[] | null>;
    addFurniture: (roomId: string, item: PlacedFurniture) => Promise<void>;
    removeFurniture: (furnitureId: string) => Promise<void>;
    close: () => void;
    savePlayerName: (userId: string, name: string) => Promise<void>;
    saveLastDailyClaim: (userId: string, timestamp: number) => Promise<void>;
    getLastDailyClaim: (userId: string) => Promise<number>;
    getInventory: (userId: string) => Promise<InventoryItem[]>;
    addItem: (userId: string, itemType: string, quantity?: number) => Promise<void>;
    removeItem: (userId: string, itemType: string, quantity?: number) => Promise<void>;
    getFriends: (userId: string) => Promise<FriendEntry[]>;
    getPendingFriendRequests: (userId: string) => Promise<PendingRequest[]>;
    sendFriendRequest: (userId: string, friendId: string) => Promise<{ success: boolean; message: string }>;
    acceptFriendRequest: (userId: string, requesterId: string) => Promise<{ success: boolean; message: string }>;
    areFriends: (userId: string, friendId: string) => Promise<boolean>;
    saveMessage: (senderId: string, recipientId: string, text: string) => Promise<void>;
    getMessages: (userId: string) => Promise<MessageRecord[]>;
    getUserSanctuaryRoom: (userId: string, playerName: string) => Promise<{ roomId: string; roomCode: string; name: string; flooring?: string; wallpaper?: string } | null>;
    saveRoomStyle?: (roomId: string, flooring?: string, wallpaper?: string) => Promise<void>;
    getRoomStyle?: (roomId: string) => Promise<{ flooring: string; wallpaper: string } | null>;
    saveRoomExpansion?: (roomId: string, width: number, height: number) => Promise<void>;
    getRoomExpansion?: (roomId: string) => Promise<{ width: number; height: number }>;
    saveRoomPermissions?: (roomId: string, accessMode: string, passwordHash?: string) => Promise<void>;
    getRoomPermissions?: (roomId: string) => Promise<{ accessMode: string; passwordHash: string | null }>;
    saveRoomMood?: (roomId: string, mood: string) => Promise<void>;
    getRoomMood?: (roomId: string) => Promise<string>;
    addRoomDecorator?: (roomId: string, userId: string) => Promise<void>;
    removeRoomDecorator?: (roomId: string, userId: string) => Promise<void>;
    getRoomDecorators?: (roomId: string) => Promise<string[]>;
    getPlayerMaterials?: (userId: string) => Promise<{ scrap_metal: number; timber: number }>;
    savePlayerMaterials?: (userId: string, mats: { scrap_metal: number; timber: number }) => Promise<void>;
    setVipMembership?: (userId: string, durationDays: number) => Promise<{ isVip: boolean; expiresAt: string }>;
    getVipStatus?: (userId: string) => Promise<{ isVip: boolean; expiresAt: string | null }>;
    createMarketplaceListing?: (sellerId: string, sellerName: string, itemType: string, priceCoins: number, priceGems?: number) => Promise<any>;
    getMarketplaceListings?: (query?: string) => Promise<any[]>;
    buyMarketplaceListing?: (listingId: string, buyerId: string, buyerCoins: number) => Promise<any>;
    cancelMarketplaceListing?: (listingId: string, sellerId: string) => Promise<any>;
  };
  ws: WebSocket;
  globalPlayers?: Map<string, Player>;
  tradeManager?: TradeManager;
  /** Daily bonus cooldown in milliseconds (24h). */
  dailyCooldownMs?: number;
}

const defaultTradeManager = new TradeManager();

/**
 * Dispatch a single client message to the appropriate room-state mutation.
 */
export async function handleMessage(msg: { type: string; payload?: Record<string, unknown> }, player: Player, ctx: DispatchContext): Promise<void> {
  const { rooms, db } = ctx;
  const room = player.room;
  const currentRoom = rooms.get(room);
  if (!currentRoom) return;

  if (['UPDATE_IDENTITY', 'SAVE_PRESET', 'APPLY_PRESET', 'UPDATE_AVATAR'].includes(msg.type)) {
    await handleIdentity(msg.type, msg.payload || {}, player, ctx);
    return;
  }
  if (msg.type.startsWith('TRADE_') && !player.authUserId) {
    rooms.send(player.ws, { type: 'TRADE_ERROR', payload: { message: 'Register or log in to trade.' } });
    return;
  }
  const dailyCooldownMs = ctx.dailyCooldownMs || (24 * 60 * 60 * 1000);

  switch (msg.type) {
    case 'MOVE_REQUEST':
    case 'MOVE_TO':
    case 'MOVE': {
      const raw = (msg.payload || {}) as Record<string, unknown>;
      // Legacy MOVE uses {x,y}; canonical MOVE_REQUEST/MOVE_TO use {targetX,targetY}.
      // validateMoveRequest converts, clamps to the grid and REJECTS non-finite
      // input (NaN/undefined/garbage) with MOVE_REJECTED — never silently
      // falling back to the player's current target.
      const now = Date.now();
      const v = validateMoveRequest(player, raw.targetX ?? raw.x, raw.targetY ?? raw.y, now);
      if (!v.ok) {
        rooms.send(player.ws, {
          type: 'MOVE_REJECTED',
          payload: { reason: v.reason || 'rejected', targetX: player.targetX, targetY: player.targetY },
        });
        break;
      }
      player.targetX = v.targetX;
      player.targetY = v.targetY;
      player.lastMoveAt = now;
      player.isSitting = false;
      const dx = player.targetX - player.x;
      const dy = player.targetY - player.y;
      if (dx !== 0 || dy !== 0) {
        const f = calculateFacing(dx, dy);
        if (f) player.facing = f;
      }
      rooms.broadcast(room, {
        type: 'PLAYER_MOVED',
        payload: {
          playerId: player.id,
          startX: player.x,
          startY: player.y,
          targetX: player.targetX,
          targetY: player.targetY,
          isSitting: false,
          facing: player.facing,
        }
      });
      if (dx !== 0 || dy !== 0) await awardIdentity(player, ctx, 'STEP');
      break;
    }

    case 'UPDATE_POSITION': {
      const cx = (msg.payload as Record<string, unknown> | undefined)?.x;
      const cy = (msg.payload as Record<string, unknown> | undefined)?.y;
      if (typeof cx === 'number' && typeof cy === 'number') {
        if (needsReconcile(player, { x: cx, y: cy }, RECONCILE_EPSILON)) {
          rooms.send(player.ws, {
            type: 'RECONCILE_POSITION',
            payload: { x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY },
          });
        }
        // Server stays authoritative: never snap server state to client claims.
      }
      break;
    }

    case 'CHAT': {
      if (player.isMuted) {
        if (player.mutedUntil && new Date(player.mutedUntil).getTime() < Date.now()) {
          player.isMuted = false;
        } else {
          rooms.send(player.ws, {
            type: 'SYSTEM_MESSAGE',
            payload: { text: 'You are muted by moderation and cannot send messages.', type: 'warning' }
          });
          return;
        }
      }
      const raw = (msg.payload && msg.payload.text) || '';
      const { text } = moderateChat(raw);
      if (!text) return;

      let chatText = text;
      let radius = DEFAULT_AUDIBLE_RADIUS;

      // In-game commands: /name <n>, /status <text>, /jump, /wave, /dance, /hug, /run, /lie, /shout <text>
      if (text.startsWith('/')) {
        const cmd = parseCommand(text);
        if (cmd && (cmd.command === 'shout' || cmd.command === 's')) {
          chatText = cmd.args;
          radius = DEFAULT_SHOUT_RADIUS;
        } else if (cmd?.command === 'status') {
          await handleIdentity('UPDATE_IDENTITY', { statusMessage: cmd.args || '' }, player, ctx);
          return;
        } else if (cmd && cmd.command === 'name' && cmd.args) {
          player.name = cmd.args.slice(0, 18).trim();
          if (ctx.globalPlayers) {
            const gp = ctx.globalPlayers.get(player.id);
            if (gp) gp.name = player.name;
          }
          const userLoftId = getUserLoftRoomId(player.id);
          const userLoft = rooms.get(userLoftId);
          if (userLoft) {
            userLoft.name = `${player.name}'s Personal Sanctuary Loft`;
          }
          db.savePlayerName(player.id, player.name).catch(() => {});
          rooms.broadcast(room, {
            type: 'PLAYER_PROFILE_UPDATED',
            payload: { playerId: player.id, player: serializePlayer(player) }
          });
          rooms.send(player.ws, {
            type: 'SYSTEM_MESSAGE',
            payload: { text: `Name updated to "${player.name}".`, type: 'system' }
          });
          return;
        } else {
          const EMOTE_COMMANDS = ['jump', 'wave', 'dance', 'hug', 'run', 'lie'];
          if (cmd && EMOTE_COMMANDS.includes(cmd.command)) {
            rooms.broadcast(room, {
              type: 'PLAYER_EMOTE',
              payload: {
                playerId: player.id,
                emote: cmd.command,
                sender: player.name
              }
            });
            return;
          }
          return;
        }
      }

      if (!chatText) return;
      player.lastChat = { text: chatText, timestamp: Date.now() };

      const chatPayload = {
        playerId: player.id,
        sender: player.name,
        text: chatText,
        timestamp: Date.now(),
        isShout: radius > DEFAULT_AUDIBLE_RADIUS,
      };

      const currentRoomObj = rooms.get(room);
      if (currentRoomObj && currentRoomObj.isPublic) {
        rooms.broadcast(
          room,
          { type: 'CHAT_MESSAGE', payload: chatPayload },
          null,
          (listener) => isWithinAudibleDistance(player, listener, radius)
        );
      } else {
        rooms.broadcast(room, { type: 'CHAT_MESSAGE', payload: chatPayload });
      }
      break;
    }

    case 'REPORT_PLAYER': {
      const { targetId, reason } = (msg.payload || {}) as { targetId?: string; reason?: string };
      if (!targetId || !reason) {
        rooms.send(player.ws, {
          type: 'SYSTEM_MESSAGE',
          payload: { text: 'Invalid report details.', type: 'warning' }
        });
        break;
      }
      await db.createPlayerReport(player.id, String(targetId), String(reason).slice(0, 500), room.id);
      rooms.send(player.ws, {
        type: 'SYSTEM_MESSAGE',
        payload: { text: 'Report received. Our moderation team has been alerted.', type: 'info' }
      });
      break;
    }

    case 'SWITCH_ROOM': {
      const targetRoomId = (msg.payload && msg.payload.roomId) as string;
      if (!targetRoomId || targetRoomId === player.room) return;

      // Access permissions check for target room
      const targetExisting = rooms.get(targetRoomId);
      const isOwner = targetExisting ? targetExisting.ownerId === player.id : (targetRoomId === getUserLoftRoomId(player.id));
      if (targetExisting && !isOwner) {
        const areFriends = targetExisting.ownerId ? await db.areFriends(targetExisting.ownerId, player.id) : false;
        const access = rooms.canAccess(targetRoomId, player.id, msg.payload?.password as string | undefined, areFriends);
        if (!access.allowed) {
          rooms.send(player.ws, {
            type: 'ROOM_ACCESS_DENIED',
            payload: {
              roomId: targetRoomId,
              reason: access.reason || 'locked',
              ownerName: access.ownerName || targetExisting.name,
            }
          });
          return;
        }
      }

      // Handle personal loft switch — create room lazily if needed
      if (rooms.isUserLoft(targetRoomId)) {
        let loftRoom = rooms.get(targetRoomId);
        if (!loftRoom) {
          // If the player is visiting their own loft:
          const myLoftId = getUserLoftRoomId(player.id);
          if (targetRoomId === myLoftId) {
            loftRoom = await rooms.getUserLoft(player.id, player.name);
          } else {
            // Player is visiting another player's loft (e.g. friend)
            loftRoom = {
              id: targetRoomId,
              name: `Loft (${targetRoomId})`,
              isPublic: false,
              players: new Map(),
              furniture: [],
              ownerId: null,
              flooring: 'parquet',
              wallpaper: 'cozy_wood',
              gridWidth: 10,
              gridHeight: 10,
              accessMode: 'public',
              decorators: new Set(),
              ambientMood: 'day',
              doorbellGrants: new Set(),
              pets: new Map(),
            };
            rooms.rooms[targetRoomId] = loftRoom;
          }
        }
        if (!loftRoom) return;
        // Load furniture and style from DB if empty
        if (loftRoom.furniture.length === 0) {
          const dbFurn = await db.getLoftFurniture(loftRoom.id);
          if (dbFurn && dbFurn.length > 0) {
            rooms.setFurniture(loftRoom.id, dbFurn);
          }
        }
        if (db.getRoomStyle) {
          const style = await db.getRoomStyle(loftRoom.id);
          if (style) {
            rooms.setRoomStyle(loftRoom.id, style.flooring, style.wallpaper);
          }
        }
        if (db.getRoomExpansion) {
          const exp = await db.getRoomExpansion(loftRoom.id);
          if (exp) {
            loftRoom.gridWidth = exp.width;
            loftRoom.gridHeight = exp.height;
          }
        }
        if (db.getRoomPermissions) {
          const perm = await db.getRoomPermissions(loftRoom.id);
          if (perm) {
            loftRoom.accessMode = perm.accessMode as any;
            if (perm.passwordHash) loftRoom.passwordHash = perm.passwordHash;
          }
        }
        if (db.getRoomMood) {
          const mood = await db.getRoomMood(loftRoom.id);
          if (mood) loftRoom.ambientMood = mood as any;
        }
        if (db.getRoomDecorators) {
          const decs = await db.getRoomDecorators(loftRoom.id);
          if (decs) loftRoom.decorators = new Set(decs);
        }
        rooms.broadcast(player.room, { type: 'PLAYER_LEFT', payload: { playerId: player.id } }, player.ws);
        rooms.leave(player);
        player.room = targetRoomId;
        player.x = 5; player.y = 8; player.targetX = 5; player.targetY = 8;
        rooms.join(targetRoomId, player);
        const target = rooms.get(targetRoomId);
        rooms.send(player.ws, {
          type: 'ROOM_CHANGED',
          payload: {
            room: serializeRoom(target!),
            player: serializePlayer(player),
            otherPlayers: rooms.othersIn(targetRoomId, player.id)
          }
        });
        await awardIdentity(player, ctx, 'ENTER_ROOM', { roomId: targetRoomId });
        rooms.broadcast(targetRoomId, { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, player.ws);
        break;
      }

      // Standard room switch (supports automatic instance sharding)
      const targetRoom = shardManager.resolveShard(targetRoomId, rooms);
      if (!rooms.get(targetRoom)) return;
      rooms.broadcast(player.room, { type: 'PLAYER_LEFT', payload: { playerId: player.id } }, player.ws);
      rooms.leave(player);
      shardManager.pruneEmptyShards(rooms);
      player.room = targetRoom;
      player.x = 5; player.y = 8; player.targetX = 5; player.targetY = 8;
      rooms.join(targetRoom, player);
      const target = rooms.get(targetRoom);
      rooms.send(player.ws, {
        type: 'ROOM_CHANGED',
        payload: {
          room: serializeRoom(target!),
          player: serializePlayer(player),
          otherPlayers: rooms.othersIn(targetRoom, player.id)
        }
      });
      rooms.broadcast(targetRoom, { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, player.ws);
      await awardIdentity(player, ctx, 'ENTER_ROOM', { roomId: targetRoom });
      break;
    }

    case 'PLACE_FURNITURE': {
      if (!rooms.canDecorate(player.room, player.id)) {
        rooms.send(player.ws, {
          type: 'FURNITURE_ERROR',
          payload: { message: 'You do not have building permissions in this room.' }
        });
        return;
      }
      const { type, x, y, rotation, elevation, parentSurfaceId, teleportTarget } = msg.payload || {};
      const newItem: PlacedFurniture = {
        id: 'f_' + Math.random().toString(36).substring(2, 9),
        type: (type as string) || 'plant',
        x: Math.round(x as number),
        y: Math.round(y as number),
        rotation: (Number(rotation) as 0 | 90 | 180 | 270) || 0,
        elevation: (elevation as number) || 0,
        parentSurfaceId: (parentSurfaceId as string) || null,
        teleportTarget: (teleportTarget as string) || undefined,
      };
      currentRoom.furniture.push(newItem);
      db.addFurniture(player.room, newItem).catch(() => {});
      rooms.broadcast(player.room, { type: 'FURNITURE_ADDED', payload: { item: newItem } });
      await awardIdentity(player, ctx, 'PLACE_FURNITURE');
      break;
    }

    case 'REMOVE_FURNITURE': {
      if (!rooms.canDecorate(player.room, player.id)) {
        rooms.send(player.ws, {
          type: 'FURNITURE_ERROR',
          payload: { message: 'You do not have building permissions in this room.' }
        });
        return;
      }
      const { id } = msg.payload || {};
      const removed = rooms.removeFurnitureById(player.room, id as string);
      if (removed) {
        db.removeFurniture(removed.id).catch(() => {});
        rooms.broadcast(player.room, { type: 'FURNITURE_REMOVED', payload: { id: removed.id } });
      }
      break;
    }

    case 'CLEAR_ROOM': {
      if (!rooms.canDecorate(player.room, player.id)) return;
      const removed = rooms.clearFurniture(player.room);
      for (const f of removed) {
        db.removeFurniture(f.id).catch(() => {});
      }
      rooms.broadcast(player.room, { type: 'ROOM_CLEARED', payload: null });
      break;
    }

    case 'ROTATE_ITEM': {
      if (!rooms.canDecorate(player.room, player.id)) return;
      const { placedItemId, rotation } = msg.payload || {};
      const item = currentRoom.furniture.find(f => f.id === placedItemId);
      if (item) {
        item.rotation = (Number(rotation) as 0 | 90 | 180 | 270) || 0;
        rooms.broadcast(player.room, { type: 'FURNITURE_STATE_UPDATED', payload: { furnitureId: item.id, state: { rotation: item.rotation } } });
      }
      break;
    }

    case 'EXPAND_ROOM': {
      const { roomId, targetSize } = msg.payload || {};
      const targetRoom = rooms.get(roomId as string) || currentRoom;
      if (!targetRoom || targetRoom.ownerId !== player.id) {
        rooms.send(player.ws, { type: 'FURNITURE_ERROR', payload: { message: 'Only the room owner can expand this loft!' } });
        return;
      }
      const validCosts: Record<number, number> = { 14: 500, 18: 1500, 20: 3000 };
      const cost = validCosts[Number(targetSize)];
      if (!cost) {
        rooms.send(player.ws, { type: 'FURNITURE_ERROR', payload: { message: 'Invalid target expansion size!' } });
        return;
      }
      if (player.coins < cost) {
        rooms.send(player.ws, { type: 'FURNITURE_ERROR', payload: { message: `Expansion requires ${cost} HavenCoins!` } });
        return;
      }
      player.coins -= cost;
      await db.addCoins(player.id, -cost);
      rooms.expandRoom(targetRoom.id, Number(targetSize));
      if (db.saveRoomExpansion) {
        await db.saveRoomExpansion(targetRoom.id, Number(targetSize), Number(targetSize));
      }
      rooms.send(player.ws, { type: 'COINS_UPDATED', payload: { coins: player.coins, earned: -cost, reason: 'Room expansion' } });
      rooms.broadcast(targetRoom.id, { type: 'ROOM_EXPANDED', payload: { roomId: targetRoom.id, gridWidth: Number(targetSize), gridHeight: Number(targetSize) } });
      break;
    }

    case 'SET_ROOM_PERMISSIONS': {
      const { roomId, accessMode, password } = msg.payload || {};
      const targetRoom = rooms.get(roomId as string) || currentRoom;
      if (!targetRoom || targetRoom.ownerId !== player.id) return;
      rooms.setAccessMode(targetRoom.id, accessMode as any, password as string | undefined);
      if (db.saveRoomPermissions) {
        await db.saveRoomPermissions(targetRoom.id, accessMode as string, password as string | undefined);
      }
      rooms.send(player.ws, { type: 'ROOM_PERMISSIONS_UPDATED', payload: { roomId: targetRoom.id, accessMode: accessMode as string } });
      break;
    }

    case 'GRANT_DECORATOR': {
      const { roomId, targetPlayerId } = msg.payload || {};
      const targetRoom = rooms.get(roomId as string) || currentRoom;
      if (!targetRoom || targetRoom.ownerId !== player.id) return;
      rooms.grantDecorator(targetRoom.id, targetPlayerId as string);
      if (db.addRoomDecorator) {
        await db.addRoomDecorator(targetRoom.id, targetPlayerId as string);
      }
      rooms.send(player.ws, { type: 'DECORATORS_UPDATED', payload: { roomId: targetRoom.id, decorators: Array.from(targetRoom.decorators) } });
      break;
    }

    case 'REVOKE_DECORATOR': {
      const { roomId, targetPlayerId } = msg.payload || {};
      const targetRoom = rooms.get(roomId as string) || currentRoom;
      if (!targetRoom || targetRoom.ownerId !== player.id) return;
      rooms.revokeDecorator(targetRoom.id, targetPlayerId as string);
      if (db.removeRoomDecorator) {
        await db.removeRoomDecorator(targetRoom.id, targetPlayerId as string);
      }
      rooms.send(player.ws, { type: 'DECORATORS_UPDATED', payload: { roomId: targetRoom.id, decorators: Array.from(targetRoom.decorators) } });
      break;
    }

    case 'RING_DOORBELL': {
      const { roomId } = msg.payload || {};
      const targetRoom = rooms.get(roomId as string);
      if (!targetRoom || !targetRoom.ownerId) return;
      const owner = targetRoom.players.get(targetRoom.ownerId) || ctx.globalPlayers?.get(targetRoom.ownerId);
      if (owner) {
        rooms.send(owner.ws, { type: 'DOORBELL_RING', payload: { visitorId: player.id, visitorName: player.name } });
      } else {
        rooms.send(player.ws, { type: 'DOORBELL_RESULT', payload: { granted: false, roomId: roomId as string, message: 'Host is away.' } });
      }
      break;
    }

    case 'DOORBELL_DECISION': {
      const { visitorId, allow } = msg.payload || {};
      const targetRoom = currentRoom;
      if (!targetRoom || targetRoom.ownerId !== player.id) return;
      if (allow) {
        rooms.grantDoorbell(targetRoom.id, visitorId as string);
        const visitor = ctx.globalPlayers?.get(visitorId as string);
        if (visitor) {
          rooms.send(visitor.ws, { type: 'DOORBELL_RESULT', payload: { granted: true, roomId: targetRoom.id, message: 'Host granted entry!' } });
        }
      }
      break;
    }

    case 'SET_ROOM_MOOD': {
      const { roomId, mood } = msg.payload || {};
      const targetRoom = rooms.get(roomId as string) || currentRoom;
      if (!targetRoom || (targetRoom.ownerId && targetRoom.ownerId !== player.id)) return;
      rooms.setRoomMood(targetRoom.id, mood as any);
      if (db.saveRoomMood) {
        await db.saveRoomMood(targetRoom.id, mood as string);
      }
      rooms.broadcast(targetRoom.id, { type: 'ROOM_MOOD_UPDATED', payload: { roomId: targetRoom.id, mood: mood as string } });
      break;
    }

    case 'TELEPORT_TRIGGER': {
      const { teleporterId } = msg.payload || {};
      const furni = currentRoom.furniture.find(f => f.id === teleporterId);
      if (furni && (furni.type === 'teleporter_pad' || furni.type === 'portal_door')) {
        const targetRoom = furni.teleportTarget || 'plaza';
        handleMessage({ type: 'SWITCH_ROOM', payload: { roomId: targetRoom } }, player, ctx);
      }
      break;
    }

    case 'WHITEBOARD_STROKE': {
      const { roomId, stroke } = msg.payload || {};
      if (roomId === player.room && stroke) {
        rooms.broadcast(roomId as string, { type: 'WHITEBOARD_STROKE', payload: { stroke } }, player.ws);
      }
      break;
    }

    case 'WHITEBOARD_CLEAR': {
      const { roomId } = msg.payload || {};
      if (roomId === player.room) {
        rooms.broadcast(roomId as string, { type: 'WHITEBOARD_CLEARED', payload: null });
      }
      break;
    }

    case 'PET_INTERACT': {
      const { petId, action } = msg.payload || {};
      const pet = currentRoom.pets?.get(petId as string);
      if (pet) {
        const updated = petInteract(pet, (action as any) || 'pet');
        currentRoom.pets.set(petId as string, updated);
        rooms.broadcast(player.room, { type: 'PETS_UPDATED', payload: { pets: Array.from(currentRoom.pets.values()) } });
      }
      break;
    }

    case 'CLAIM_DAILY_BONUS': {
      const now = Date.now();
      const lastClaim = player.lastDailyClaim || 0;

      // Check if the player has already claimed today (24h cooldown)
      if (lastClaim > 0 && (now - lastClaim) < dailyCooldownMs) {
        const msLeft = dailyCooldownMs - (now - lastClaim);
        const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000));
        const minsLeft = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
        rooms.send(player.ws, {
          type: 'DAILY_BONUS_ERROR',
          payload: {
            message: `You've already collected your daily gift! Come back in ${hoursLeft}h ${minsLeft}m for your next daily gift.`,
            lastClaim: lastClaim,
            nextClaimAvailable: lastClaim + dailyCooldownMs
          }
        });
        return;
      }

      // Double-check against DB (in case server restarted between checks)
      const dbLastClaim = await db.getLastDailyClaim(player.id);
      if (dbLastClaim > 0 && (now - dbLastClaim) < dailyCooldownMs) {
        const msLeft = dailyCooldownMs - (now - dbLastClaim);
        const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000));
        const minsLeft = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
        rooms.send(player.ws, {
          type: 'DAILY_BONUS_ERROR',
          payload: {
            message: `You've already collected your daily gift! Come back in ${hoursLeft}h ${minsLeft}m for your next daily gift.`,
            lastClaim: dbLastClaim,
            nextClaimAvailable: dbLastClaim + dailyCooldownMs
          }
        });
        return;
      }

      player.coins += 250;
      player.lastDailyClaim = now;
      db.addCoins(player.id, 250).catch(() => {});
      db.saveLastDailyClaim(player.id, now).catch(() => {});
      rooms.send(player.ws, {
        type: 'COINS_UPDATED',
        payload: { coins: player.coins, earned: 250, reason: 'Daily Sanctuary Bonus' }
      });
      break;
    }

    case 'GET_DAILY_COOLDOWN': {
      const now = Date.now();
      const lastClaim = player.lastDailyClaim || 0;
      const dbLastClaim = await db.getLastDailyClaim(player.id);
      const effectiveLastClaim = Math.max(lastClaim, dbLastClaim);

      if (effectiveLastClaim > 0) {
        const msLeft = dailyCooldownMs - (now - effectiveLastClaim);
        const canClaim = msLeft <= 0;
        rooms.send(player.ws, {
          type: 'DAILY_COOLDOWN_UPDATE',
          payload: {
            canClaim,
            lastClaim: effectiveLastClaim,
            nextClaimAvailable: effectiveLastClaim + dailyCooldownMs,
            timeRemainingMs: Math.max(0, msLeft)
          }
        });
      } else {
        rooms.send(player.ws, {
          type: 'DAILY_COOLDOWN_UPDATE',
          payload: {
            canClaim: true,
            lastClaim: 0,
            nextClaimAvailable: 0,
            timeRemainingMs: 0
          }
        });
      }
      break;
    }

    case 'MINIGAME_SCORE': {
      const score = msg.payload?.score;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return;
      const reward = Math.max(50, Math.min(500, Math.floor(score / 2)));
      await awardIdentity(player, ctx, 'MINIGAME_SCORE', { score: reward });
      player.coins += reward;
      db.addCoins(player.id, reward).catch(() => {});
      rooms.send(player.ws, {
        type: 'COINS_UPDATED',
        payload: { coins: player.coins, earned: reward, reason: 'Pizza Chef Payout' }
      });
      rooms.broadcast(room, {
        type: 'SYSTEM_ANNOUNCEMENT',
        payload: { text: `🍕 ${player.name} finished a shift at Pizza Chef and earned ${reward} HavenCoins!` }
      });
      break;
    }

    case 'UPDATE_AVATAR': {
      if (msg.payload && msg.payload.avatar) Object.assign(player.avatar, msg.payload.avatar);
      if (msg.payload && msg.payload.name) {
        player.name = String(msg.payload.name as string).trim().slice(0, 18) || player.name;
        db.savePlayerName(player.id, player.name).catch(() => {});
      }
      db.saveAvatar(player.id, player.avatar).catch(() => {});
      rooms.broadcast(room, {
        type: 'PLAYER_PROFILE_UPDATED',
        payload: { playerId: player.id, player: serializePlayer(player) }
      });
      break;
    }

    // --- Shop & Inventory ---

    case 'GET_SHOP_CATALOG': {
      rooms.send(player.ws, {
        type: 'SHOP_CATALOG',
        payload: {
          items: CATALOG_ITEMS,
          rotatingStock: getRotatingFeaturedStock(),
          nextRotationMs: getTimeUntilNextRotation(),
        }
      });
      break;
    }

    case 'GET_INVENTORY': {
      db.getInventory(player.id).then((inventory) => {
        rooms.send(player.ws, {
          type: 'INVENTORY_UPDATE',
          payload: { items: inventory }
        });
      });
      break;
    }

    case 'BUY_ITEM': {
      const itemKey = msg.payload!.itemKey as string;
      const rotating = getRotatingFeaturedStock();
      const item = CATALOG_ITEMS[itemKey] || rotating.find(i => i.id === itemKey);
      if (!item) {
        rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Item not found in shop!' } });
        return;
      }
      if (item.currency === 'gems') {
        if (player.gems < item.price) {
          rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Not enough HavenGems!' } });
          return;
        }
        player.gems -= item.price;
        if (db.addGems) await db.addGems(player.id, -item.price);
        await db.addItem(player.id, itemKey, 1);
        const inventory = await db.getInventory(player.id);
        rooms.send(player.ws, { type: 'GEMS_UPDATED', payload: { gems: player.gems, earned: -item.price, reason: `Bought ${item.name}` } });
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: inventory } });
      } else {
        if (player.coins < item.price) {
          rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Not enough HavenCoins!' } });
          return;
        }
        player.coins -= item.price;
        await db.addCoins(player.id, -item.price);
        await db.addItem(player.id, itemKey, 1);
        const inventory = await db.getInventory(player.id);
        rooms.send(player.ws, { type: 'COINS_UPDATED', payload: { coins: player.coins, earned: -item.price, reason: `Bought ${item.name}` } });
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: inventory } });
      }
      break;
    }

    case 'SELL_ITEM': {
      const itemType = msg.payload!.itemType as string;
      const sellQty = msg.payload!.quantity as number;
      const item = CATALOG_ITEMS[itemType as keyof typeof CATALOG_ITEMS];
      if (!item) {
        rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Cannot sell this item!' } });
        return;
      }
      db.getInventory(player.id).then(async (inventory) => {
        const ownedItem = inventory.find((i: InventoryItem) => i.item_type === itemType);
        if (!ownedItem || ownedItem.quantity < sellQty) {
          rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Not enough items to sell!' } });
          return;
        }
        const sellPrice = Math.floor(item.price * 0.5);
        const totalEarnings = sellPrice * sellQty;
        await db.removeItem(player.id, itemType, sellQty);
        player.coins += totalEarnings;
        await db.addCoins(player.id, totalEarnings);
        const updatedInv = await db.getInventory(player.id);
        rooms.send(player.ws, { type: 'COINS_UPDATED', payload: { coins: player.coins, earned: totalEarnings, reason: `Sold ${sellQty}x ${item.name}` } });
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: updatedInv } });
      });
      break;
    }

    // --- Player Marketplace ---

    case 'LIST_MARKETPLACE_ITEM': {
      const { itemType, priceCoins, priceGems } = msg.payload || {};
      if (!db.createMarketplaceListing) return;
      const result = await db.createMarketplaceListing(
        player.id,
        player.name,
        itemType as string,
        Number(priceCoins) || 0,
        Number(priceGems) || 0
      );
      if (result.success) {
        rooms.send(player.ws, { type: 'MARKETPLACE_SUCCESS', payload: { message: 'Item listed successfully!', listingId: result.listingId } });
        const listings = await db.getMarketplaceListings!();
        rooms.send(player.ws, { type: 'MARKETPLACE_LISTINGS', payload: { listings } });
        const inventory = await db.getInventory(player.id);
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: inventory } });
      } else {
        rooms.send(player.ws, { type: 'MARKETPLACE_ERROR', payload: { message: result.message || 'Failed to list item' } });
      }
      break;
    }

    case 'BROWSE_MARKETPLACE': {
      const { query } = msg.payload || {};
      if (db.getMarketplaceListings) {
        const listings = await db.getMarketplaceListings(query as string | undefined);
        rooms.send(player.ws, { type: 'MARKETPLACE_LISTINGS', payload: { listings } });
      }
      break;
    }

    case 'BUY_MARKETPLACE_ITEM': {
      const { listingId } = msg.payload || {};
      if (!db.buyMarketplaceListing) return;
      const result = await db.buyMarketplaceListing(listingId as string, player.id, player.coins);
      if (result.success) {
        player.coins -= result.netPaid!;
        rooms.send(player.ws, { type: 'COINS_UPDATED', payload: { coins: player.coins, earned: -result.netPaid!, reason: 'Marketplace purchase' } });
        rooms.send(player.ws, { type: 'MARKETPLACE_SUCCESS', payload: { message: `Purchased ${result.itemType}!` } });
        const listings = await db.getMarketplaceListings!();
        rooms.send(player.ws, { type: 'MARKETPLACE_LISTINGS', payload: { listings } });
        const inventory = await db.getInventory(player.id);
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: inventory } });
      } else {
        rooms.send(player.ws, { type: 'MARKETPLACE_ERROR', payload: { message: result.message || 'Purchase failed' } });
      }
      break;
    }

    case 'CANCEL_MARKETPLACE_LISTING': {
      const { listingId } = msg.payload || {};
      if (!db.cancelMarketplaceListing) return;
      const result = await db.cancelMarketplaceListing(listingId as string, player.id);
      if (result.success) {
        rooms.send(player.ws, { type: 'MARKETPLACE_SUCCESS', payload: { message: 'Listing cancelled, item returned to inventory.' } });
        const listings = await db.getMarketplaceListings!();
        rooms.send(player.ws, { type: 'MARKETPLACE_LISTINGS', payload: { listings } });
        const inventory = await db.getInventory(player.id);
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: inventory } });
      } else {
        rooms.send(player.ws, { type: 'MARKETPLACE_ERROR', payload: { message: result.message || 'Failed to cancel listing' } });
      }
      break;
    }

    // --- Furniture Recycling & Crafting ---

    case 'RECYCLE_ITEM': {
      const { itemType } = msg.payload || {};
      const inv = await db.getInventory(player.id);
      const userItem = inv.find((i: InventoryItem) => i.item_type === itemType && i.quantity > 0);
      if (!userItem) {
        rooms.send(player.ws, { type: 'CRAFTING_ERROR', payload: { message: 'Item not in inventory to recycle' } });
        return;
      }
      await db.removeItem(player.id, itemType as string, 1);
      const salvage = calculateSalvageYield(itemType as string);
      const currentMats = db.getPlayerMaterials ? await db.getPlayerMaterials(player.id) : { scrap_metal: 0, timber: 0 };
      const updatedMats = {
        scrap_metal: currentMats.scrap_metal + salvage.scrap_metal,
        timber: currentMats.timber + salvage.timber,
      };
      if (db.savePlayerMaterials) {
        await db.savePlayerMaterials(player.id, updatedMats);
      }
      player.materials = updatedMats;
      const updatedInv = await db.getInventory(player.id);
      rooms.send(player.ws, {
        type: 'RECYCLE_SUCCESS',
        payload: { itemType: itemType as string, gained: salvage, materials: updatedMats }
      });
      rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: updatedInv } });
      break;
    }

    case 'CRAFT_ITEM': {
      const { recipeId } = msg.payload || {};
      const currentMats = db.getPlayerMaterials ? await db.getPlayerMaterials(player.id) : { scrap_metal: 0, timber: 0 };
      if (!canCraftRecipe(recipeId as string, currentMats)) {
        rooms.send(player.ws, { type: 'CRAFTING_ERROR', payload: { message: 'Insufficient materials to craft this recipe' } });
        return;
      }
      const updatedMats = deductCraftingMaterials(recipeId as string, currentMats);
      if (db.savePlayerMaterials) {
        await db.savePlayerMaterials(player.id, updatedMats);
      }
      player.materials = updatedMats;
      await db.addItem(player.id, recipeId as string, 1);
      const updatedInv = await db.getInventory(player.id);
      rooms.send(player.ws, {
        type: 'CRAFT_SUCCESS',
        payload: { recipeId: recipeId as string, itemType: recipeId as string, materials: updatedMats }
      });
      rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: updatedInv } });
      break;
    }

    // --- Club Haven VIP Membership ---

    case 'BUY_VIP_MEMBERSHIP': {
      const vipCost = 1000;
      if (player.coins < vipCost) {
        rooms.send(player.ws, { type: 'FURNITURE_ERROR', payload: { message: 'Club Haven VIP requires 1,000 HavenCoins!' } });
        return;
      }
      player.coins -= vipCost;
      await db.addCoins(player.id, -vipCost);
      const vipResult = db.setVipMembership ? await db.setVipMembership(player.id, 30) : { isVip: true, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() };
      player.isVip = true;
      player.vipExpiresAt = vipResult.expiresAt;
      rooms.send(player.ws, { type: 'COINS_UPDATED', payload: { coins: player.coins, earned: -vipCost, reason: 'Club Haven VIP (30 days)' } });
      rooms.send(player.ws, { type: 'VIP_UPDATED', payload: { isVip: true, vipExpiresAt: vipResult.expiresAt } });
      rooms.broadcast(player.room, { type: 'PLAYER_PROFILE_UPDATED', payload: { playerId: player.id, player: serializePlayer(player) } });
      break;
    }

    // --- Friends System ---

    case 'GET_FRIENDS_LIST': {
      const [friends, pendingRequests] = await Promise.all([db.getFriends(player.id), db.getPendingFriendRequests(player.id)]);
      const profiles = await Promise.all(friends.map(async friend => {
        const online = ctx.globalPlayers?.get(friend.friendId);
        const identity = online?.identity || await db.loadIdentity?.(friend.friendId);
        return { ...friend, name: online?.name || friend.friendId, statusMessage: identity?.statusMessage || '' };
      }));
      rooms.send(player.ws, { type: 'FRIENDS_LIST_UPDATE', payload: { friends: profiles, pendingRequests } });
      break;
    }

    case 'SEND_FRIEND_REQUEST': {
      const targetName = msg.payload!.targetName as string;
      if (!targetName) {
        rooms.send(player.ws, { type: 'FRIEND_REQUEST_ERROR', payload: { message: 'Target player name is required.' } });
        return;
      }
      // Look up target player by name across all connected players
      let targetPlayer: Player | undefined;
      if (ctx.globalPlayers) {
        for (const p of ctx.globalPlayers.values()) {
          if (p.name === targetName) { targetPlayer = p; break; }
        }
      }
      if (!targetPlayer) {
        rooms.send(player.ws, { type: 'FRIEND_REQUEST_ERROR', payload: { message: 'Player not found or offline.' } });
        return;
      }
      if (targetPlayer.id === player.id) {
        rooms.send(player.ws, { type: 'FRIEND_REQUEST_ERROR', payload: { message: 'You cannot add yourself as a friend.' } });
        return;
      }
      db.areFriends(player.id, targetPlayer.id).then((alreadyFriends) => {
        if (alreadyFriends) {
          rooms.send(player.ws, { type: 'FRIEND_REQUEST_ERROR', payload: { message: 'You are already friends with this player.' } });
          return;
        }
        db.sendFriendRequest(player.id, targetPlayer.id).then((result) => {
          rooms.send(player.ws, { type: 'FRIEND_REQUEST_SENT', payload: { message: result.message, targetPlayerId: targetPlayer.id } });
          if (targetPlayer.ws && targetPlayer.ws.readyState === 1) {
            rooms.send(targetPlayer.ws, {
              type: 'FRIEND_REQUEST_RECEIVED',
              payload: { fromPlayerId: player.id, fromPlayerName: player.name }
            });
          }
        });
      });
      break;
    }

    case 'ACCEPT_FRIEND_REQUEST': {
      const requesterId = msg.payload!.requesterId as string;
      db.acceptFriendRequest(player.id, requesterId).then((result) => {
        rooms.send(player.ws, { type: 'FRIEND_REQUEST_ACCEPTED', payload: { message: result.message, friendId: requesterId } });
        const requester = ctx.globalPlayers?.get(requesterId);
        if (requester && requester.ws && requester.ws.readyState === 1) {
          rooms.send(requester.ws, {
            type: 'FRIEND_REQUEST_ACCEPTED',
            payload: { message: `${player.name} accepted your friend request!`, friendId: player.id }
          });
        }
      });
      break;
    }

    // --- Private Messaging ---

    case 'SEND_PRIVATE_MESSAGE': {
      const targetPlayerId = msg.payload!.targetPlayerId as string;
      const text = msg.payload!.text as string;
      if (!targetPlayerId || !text) {
        rooms.send(player.ws, { type: 'PRIVATE_MESSAGE_ERROR', payload: { message: 'Target player and message text are required.' } });
        return;
      }
      db.areFriends(player.id, targetPlayerId).then((isFriend) => {
        if (!isFriend) {
          rooms.send(player.ws, { type: 'PRIVATE_MESSAGE_ERROR', payload: { message: 'You can only message friends.' } });
          return;
        }
        const filteredText = text.trim().substring(0, 280);
        if (!filteredText) {
          rooms.send(player.ws, { type: 'PRIVATE_MESSAGE_ERROR', payload: { message: 'Message is empty.' } });
          return;
        }
        db.saveMessage(player.id, targetPlayerId, filteredText).then(() => {
          const messageData = {
            type: 'PRIVATE_MESSAGE_RECEIVED',
            payload: {
              fromPlayerId: player.id,
              fromPlayerName: player.name,
              text: filteredText,
              timestamp: Date.now()
            }
          };
          // Send to recipient if online
          const targetP = ctx.globalPlayers?.get(targetPlayerId);
          if (targetP && targetP.ws && targetP.ws.readyState === 1) {
            rooms.send(targetP.ws, messageData);
          }
          // Echo back to sender (so they see their own message in the PM window)
          rooms.send(player.ws, messageData);
        });
      });
      break;
    }

    case 'GET_PRIVATE_MESSAGES': {
      db.getMessages(player.id).then((messages) => {
        rooms.send(player.ws, { type: 'PRIVATE_MESSAGES_LIST', payload: { messages } });
      });
      break;
    }

    // --- Social Emotes (Hug, Wave, Heart) ---
    case 'PLAYER_EMOTE': {
      const emote = (msg.payload && msg.payload.emote as string) || 'hug';
      const targetPlayerId = (msg.payload && msg.payload.targetPlayerId as string) || undefined;
      const targetP = targetPlayerId ? (currentRoom.players.get(targetPlayerId) || ctx.globalPlayers?.get(targetPlayerId)) : undefined;

      if (!['hug', 'wave', 'heart', 'dance', 'jump', 'run', 'lie'].includes(emote)) return;
      await awardIdentity(player, ctx, 'EMOTE');
      let emoteText = '';
      if (emote === 'hug') {
        emoteText = targetP ? `*hugs ${targetP.name} warmly! 🫂*` : `*offers a warm hug! 🫂*`;
      } else if (emote === 'wave') {
        emoteText = targetP ? `*waves to ${targetP.name}! 👋*` : `*waves to everyone! 👋*`;
      } else if (emote === 'heart') {
        emoteText = targetP ? `*sends love to ${targetP.name}! 💖*` : `*shares some love! 💖*`;
      } else {
        emoteText = `*${emote}*`;
      }

      // Broadcast as chat announcement to room
      rooms.broadcast(room, {
        type: 'CHAT_MESSAGE',
        payload: {
          playerId: player.id,
          sender: player.name,
          text: emoteText,
          channel: 'room',
          timestamp: Date.now(),
        }
      });

      // Also broadcast dedicated visual emote event
      rooms.broadcast(room, {
        type: 'PLAYER_EMOTED',
        payload: {
          fromPlayerId: player.id,
          fromPlayerName: player.name,
          emote,
          targetPlayerId: targetP?.id,
          targetPlayerName: targetP?.name,
          text: emoteText,
        }
      });
      break;
    }

    // --- Room Customization (Flooring & Wallpaper) ---
    case 'UPDATE_ROOM_STYLE': {
      const isOwner = currentRoom.ownerId === player.id || currentRoom.id === getUserLoftRoomId(player.id);
      if (!isOwner) {
        rooms.send(player.ws, { type: 'FURNITURE_ERROR', payload: { message: 'You can only customize your own loft style.' } });
        return;
      }
      const { flooring, wallpaper } = (msg.payload || {}) as { flooring?: string; wallpaper?: string };
      if (flooring) currentRoom.flooring = flooring;
      if (wallpaper) currentRoom.wallpaper = wallpaper;
      if (db.saveRoomStyle) {
        await db.saveRoomStyle(room, flooring, wallpaper);
      }
      await awardIdentity(player, ctx, 'UPDATE_STYLE');
      rooms.broadcast(room, {
        type: 'ROOM_STYLE_UPDATED',
        payload: {
          roomId: room,
          flooring: currentRoom.flooring,
          wallpaper: currentRoom.wallpaper,
        }
      });
      break;
    }

    // --- Furniture Interaction (Seating & Lighting) ---
    case 'INTERACT_FURNITURE': {
      const { furnitureId, action } = (msg.payload || {}) as { furnitureId?: string; action?: 'sit' | 'toggle' | 'stand' };
      if (!furnitureId) return;
      const furni = currentRoom.furniture.find((f) => f.id === furnitureId);
      if (!furni) return;

      const seatTypes = ['sofa', 'bench', 'chair', 'stool', 'bed'];
      const lightTypes = ['lamp', 'neon', 'plant', 'tv'];

      if (action === 'stand') {
        player.isSitting = false;
        rooms.broadcast(room, {
          type: 'PLAYER_MOVED',
          payload: {
            playerId: player.id,
            startX: player.x,
            startY: player.y,
            targetX: player.x,
            targetY: player.y,
            isSitting: false,
            facing: player.facing,
          }
        });
      } else if (action === 'sit' || (!action && seatTypes.includes(furni.type))) {
        player.x = furni.x;
        player.y = furni.y;
        player.targetX = furni.x;
        player.targetY = furni.y;
        player.isSitting = true;
        await awardIdentity(player, ctx, 'SIT');
        rooms.broadcast(room, {
          type: 'PLAYER_MOVED',
          payload: {
            playerId: player.id,
            startX: player.x,
            startY: player.y,
            targetX: player.targetX,
            targetY: player.targetY,
            isSitting: true,
            facing: player.facing,
          }
        });
      } else if (action === 'toggle' || (!action && lightTypes.includes(furni.type))) {
        await awardIdentity(player, ctx, 'TOGGLE_LIGHT');
        const currentState = furni.state || { isOn: false };
        furni.state = {
          ...currentState,
          isOn: !currentState.isOn,
        };
        rooms.broadcast(room, {
          type: 'FURNITURE_STATE_UPDATED',
          payload: { furnitureId: furni.id, state: furni.state }
        });
      }
      break;
    }

    // --- Room Directory / Navigator ---
    case 'GET_ROOM_DIRECTORY': {
      const publicRooms = [
        { id: 'plaza', name: '🏢 Central Plaza & Lounge', description: 'The bustling town center and social hub.', count: rooms.get('plaza')?.players.size || 0 }
      ];
      const personalLofts: { id: string; ownerId: string; ownerName: string; statusMessage: string; name: string; count: number }[] = [];
      if (ctx.globalPlayers) {
        for (const [_, p] of ctx.globalPlayers) {
          const loftId = getUserLoftRoomId(p.id);
          const loft = rooms.get(loftId);
          if (loft) {
            personalLofts.push({
              id: loftId,
              ownerId: p.id,
              ownerName: p.name,
              statusMessage: p.identity?.statusMessage || '',
              name: loft.name || `${p.name}'s Cozy Loft`,
              count: loft.players.size
            });
          }
        }
      }
      rooms.send(player.ws, {
        type: 'ROOM_DIRECTORY_UPDATE',
        payload: { publicRooms, personalLofts }
      });
      break;
    }

    // --- Direct Trading ---
    case 'TRADE_REQUEST': {
      const { targetPlayerId } = (msg.payload || {}) as { targetPlayerId?: string };
      if (!targetPlayerId || targetPlayerId === player.id) {
        rooms.send(player.ws, { type: 'TRADE_ERROR', payload: { message: 'Invalid trade partner selected.' } });
        return;
      }
      const targetP = ctx.globalPlayers?.get(targetPlayerId);
      if (!targetP) {
        rooms.send(player.ws, { type: 'TRADE_ERROR', payload: { message: 'Player is no longer online.' } });
        return;
      }
      if (!targetP.authUserId) {
        rooms.send(player.ws, { type: 'TRADE_ERROR', payload: { message: 'Both players must be registered to trade.' } });
        return;
      }
      const tradeManager = ctx.tradeManager || defaultTradeManager;
      const session = tradeManager.createSession(player.id, targetP.id);
      rooms.send(targetP.ws, {
        type: 'TRADE_REQUEST_RECEIVED',
        payload: { tradeId: session.id, fromPlayerId: player.id, fromPlayerName: player.name }
      });
      rooms.send(player.ws, {
        type: 'TRADE_REQUEST_SENT',
        payload: { tradeId: session.id, targetPlayerId: targetP.id, targetPlayerName: targetP.name }
      });
      break;
    }

    case 'TRADE_ACCEPT': {
      const { tradeId } = (msg.payload || {}) as { tradeId?: string };
      if (!tradeId) return;
      const tradeManager = ctx.tradeManager || defaultTradeManager;
      const session = tradeManager.acceptRequest(tradeId, player.id);
      if (!session) {
        rooms.send(player.ws, { type: 'TRADE_ERROR', payload: { message: 'Trade request expired or invalid.' } });
        return;
      }
      const p1 = ctx.globalPlayers?.get(session.player1Id);
      const p2 = ctx.globalPlayers?.get(session.player2Id);
      if (p1) rooms.send(p1.ws, { type: 'TRADE_STARTED', payload: { tradeId: session.id, session, partnerName: p2?.name || 'Partner' } });
      if (p2) rooms.send(p2.ws, { type: 'TRADE_STARTED', payload: { tradeId: session.id, session, partnerName: p1?.name || 'Partner' } });
      break;
    }

    case 'TRADE_UPDATE_OFFER': {
      const { tradeId, coins, items } = (msg.payload || {}) as { tradeId?: string; coins?: number; items?: string[] };
      if (!tradeId) return;
      const tradeManager = ctx.tradeManager || defaultTradeManager;
      const validCoins = Math.max(0, Math.min(player.coins, Number(coins) || 0));
      const session = tradeManager.updateOffer(tradeId, player.id, validCoins, items || []);
      if (session) {
        const p1 = ctx.globalPlayers?.get(session.player1Id);
        const p2 = ctx.globalPlayers?.get(session.player2Id);
        if (p1) rooms.send(p1.ws, { type: 'TRADE_UPDATED', payload: { tradeId: session.id, session } });
        if (p2) rooms.send(p2.ws, { type: 'TRADE_UPDATED', payload: { tradeId: session.id, session } });
      }
      break;
    }

    case 'TRADE_LOCK': {
      const { tradeId, locked } = (msg.payload || {}) as { tradeId?: string; locked?: boolean };
      if (!tradeId) return;
      const tradeManager = ctx.tradeManager || defaultTradeManager;
      const session = tradeManager.lockOffer(tradeId, player.id, !!locked);
      if (session) {
        const p1 = ctx.globalPlayers?.get(session.player1Id);
        const p2 = ctx.globalPlayers?.get(session.player2Id);
        if (p1) rooms.send(p1.ws, { type: 'TRADE_UPDATED', payload: { tradeId: session.id, session } });
        if (p2) rooms.send(p2.ws, { type: 'TRADE_UPDATED', payload: { tradeId: session.id, session } });
      }
      break;
    }

    case 'TRADE_CONFIRM': {
      const { tradeId } = (msg.payload || {}) as { tradeId?: string };
      if (!tradeId) return;
      const tradeManager = ctx.tradeManager || defaultTradeManager;
      const { session, ready } = tradeManager.confirmTrade(tradeId, player.id);
      if (!session) return;
      const p1 = ctx.globalPlayers?.get(session.player1Id);
      const p2 = ctx.globalPlayers?.get(session.player2Id);

      if (ready && p1 && p2) {
        const p1CoinsOffered = session.player1Offer.coins;
        const p2CoinsOffered = session.player2Offer.coins;

        p1.coins = p1.coins - p1CoinsOffered + p2CoinsOffered;
        p2.coins = p2.coins - p2CoinsOffered + p1CoinsOffered;

        db.addCoins(p1.id, p2CoinsOffered - p1CoinsOffered).catch(() => {});
        db.addCoins(p2.id, p1CoinsOffered - p2CoinsOffered).catch(() => {});

        for (const it of session.player1Offer.items) {
          db.removeItem(p1.id, it, 1).catch(() => {});
          db.addItem(p2.id, it, 1).catch(() => {});
        }
        for (const it of session.player2Offer.items) {
          db.removeItem(p2.id, it, 1).catch(() => {});
          db.addItem(p1.id, it, 1).catch(() => {});
        }

        rooms.send(p1.ws, { type: 'TRADE_COMPLETED', payload: { tradeId: session.id, message: 'Trade successful!' } });
        rooms.send(p2.ws, { type: 'TRADE_COMPLETED', payload: { tradeId: session.id, message: 'Trade successful!' } });

        rooms.send(p1.ws, { type: 'COINS_UPDATED', payload: { coins: p1.coins, earned: p2CoinsOffered - p1CoinsOffered, reason: 'Trade' } });
        rooms.send(p2.ws, { type: 'COINS_UPDATED', payload: { coins: p2.coins, earned: p1CoinsOffered - p2CoinsOffered, reason: 'Trade' } });
      } else {
        if (p1) rooms.send(p1.ws, { type: 'TRADE_UPDATED', payload: { tradeId: session.id, session } });
        if (p2) rooms.send(p2.ws, { type: 'TRADE_UPDATED', payload: { tradeId: session.id, session } });
      }
      break;
    }

    case 'TRADE_CANCEL': {
      const { tradeId } = (msg.payload || {}) as { tradeId?: string };
      if (!tradeId) return;
      const tradeManager = ctx.tradeManager || defaultTradeManager;
      const session = tradeManager.getSession(tradeId);
      if (session) {
        const p1 = ctx.globalPlayers?.get(session.player1Id);
        const p2 = ctx.globalPlayers?.get(session.player2Id);
        tradeManager.cancelTrade(tradeId);
        if (p1) rooms.send(p1.ws, { type: 'TRADE_CANCELED', payload: { tradeId, reason: `${player.name} canceled the trade.` } });
        if (p2) rooms.send(p2.ws, { type: 'TRADE_CANCELED', payload: { tradeId, reason: `${player.name} canceled the trade.` } });
      }
      break;
    }

    default:
      break;
  }
}

export default { handleMessage };
