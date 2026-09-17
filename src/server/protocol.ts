/**
 * HavenWorld — WebSocket message dispatcher (TypeScript).
 * Maps a client message { type, payload } to room-state mutations and
 * outbound events. db calls are self-noops in memory mode.
 */
import { clampGrid } from '../shared/iso.ts';
import { calculateFacing } from '../shared/movement.ts';
import { parseCommand, moderateChat } from './moderation.ts';
import { serializePlayer, serializeRoom, RoomManager, getUserLoftRoomId } from './rooms.ts';
import { TradeManager } from './trade.ts';
import type { Player } from './rooms.ts';
import type { PlacedFurniture, Avatar, ShopItem, InventoryItem, FriendEntry, PendingRequest, MessageRecord } from '../shared/types.ts';
import type { WebSocket } from 'ws';

const GRID_MAX = 11;

// --- Shop Catalog (Phase 1 furniture + clothing items) ---
const SHOP_ITEMS: Record<string, ShopItem> = {
  // Furniture
  'sofa':      { name: 'Cozy Velvet Sofa',   price: 500,  category: 'furniture', icon: '🛋️' },
  'table':     { name: 'Oak Coffee Table',    price: 300,  category: 'furniture', icon: '🪵' },
  'plant':     { name: 'Monstera Plant',      price: 150,  category: 'furniture', icon: '🪴' },
  'tv':        { name: 'Retro CRT TV',        price: 400,  category: 'furniture', icon: '📺' },
  'neon':      { name: 'Neon Wall Sign',      price: 600,  category: 'furniture', icon: '✨' },
  'arcade':    { name: 'Arcade Cabinet',      price: 800,  category: 'furniture', icon: '🕹️' },
  'bed':       { name: 'Cozy Bed',            price: 750,  category: 'furniture', icon: '🛏️' },
  'bookshelf': { name: 'Wooden Bookshelf',    price: 450,  category: 'furniture', icon: '📚' },
  // Clothing
  'hair_pink':     { name: 'Pink Hair Dye',   price: 200, category: 'clothing', icon: '💗' },
  'hair_blue':     { name: 'Blue Hair Dye',   price: 200, category: 'clothing', icon: '💙' },
  'shirt_purple':  { name: 'Purple Hoodie',   price: 350, category: 'clothing', icon: '💜' },
  'pants_black':   { name: 'Black Pants',     price: 250, category: 'clothing', icon: '🖤' },
  'shoes_sneakers':{ name: 'Sneakers',        price: 300, category: 'clothing', icon: '👟' },
};


export interface DispatchContext {
  rooms: RoomManager;
  db: {
    getMode: () => string;
    initPlayerProfile: (userId: string, username: string) => Promise<void>;
    saveAvatar: (userId: string, avatar: Avatar) => Promise<void>;
    addCoins: (userId: string, amount: number) => Promise<void>;
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

  const dailyCooldownMs = ctx.dailyCooldownMs || (24 * 60 * 60 * 1000);

  switch (msg.type) {
    case 'MOVE': {
      const { x, y } = msg.payload || {};
      player.targetX = clampGrid(typeof x === 'number' ? x : (Number(x) ?? player.x), GRID_MAX);
      player.targetY = clampGrid(typeof y === 'number' ? y : (Number(y) ?? player.y), GRID_MAX);
      player.isSitting = false;
      const dx = player.targetX - player.x;
      const dy = player.targetY - player.y;
      if (dx !== 0 || dy !== 0) {
        player.facing = calculateFacing(dx, dy, player.facing || 'SE');
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
      break;
    }

    case 'UPDATE_POSITION': {
      player.x = msg.payload!.x as number;
      player.y = msg.payload!.y as number;
      break;
    }

    case 'CHAT': {
      const raw = (msg.payload && msg.payload.text) || '';
      const { text } = moderateChat(raw);
      if (!text) return;

      // In-game commands: /name <n>, /jump, /wave, /dance, /hug
      if (text.startsWith('/')) {
        const cmd = parseCommand(text);
        if (cmd && cmd.command === 'name' && cmd.args) {
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
        }

        if (cmd && (cmd.command === 'jump' || cmd.command === 'wave' || cmd.command === 'dance' || cmd.command === 'hug')) {
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

      player.lastChat = { text, timestamp: Date.now() };
      rooms.broadcast(room, {
        type: 'CHAT_MESSAGE',
        payload: { playerId: player.id, sender: player.name, text, timestamp: Date.now() }
      });
      break;
    }

    case 'SWITCH_ROOM': {
      const targetRoomId = (msg.payload && msg.payload.roomId) as string;
      if (!targetRoomId || targetRoomId === player.room) return;

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
            // Create the room shell with a friendly default name
            loftRoom = {
              id: targetRoomId,
              name: `Loft (${targetRoomId})`,
              isPublic: false,
              players: new Map(),
              furniture: [],
              ownerId: null,
              flooring: 'parquet',
              wallpaper: 'cozy_wood',
            };
            rooms.rooms[targetRoomId] = loftRoom;
          }
        }
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
        rooms.broadcast(targetRoomId, { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, player.ws);
        break;
      }

      // Standard room switch
      if (!rooms.get(targetRoomId)) return;
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
      rooms.broadcast(targetRoomId, { type: 'PLAYER_JOINED', payload: { player: serializePlayer(player) } }, player.ws);
      break;
    }

    case 'PLACE_FURNITURE': {
      // Only allow placing furniture in the player's OWN personal sanctuary loft
      const playerLoftId = getUserLoftRoomId(player.id);
      if (player.room !== playerLoftId) {
        rooms.send(player.ws, {
          type: 'FURNITURE_ERROR',
          payload: { message: 'Furniture can only be placed in your own Personal Sanctuary Loft!' }
        });
        return;
      }
      const { type, x, y, elevation, parentSurfaceId } = msg.payload || {};
      const newItem = {
        id: 'f_' + Math.random().toString(36).substring(2, 9),
        type: (type as string) || 'plant',
        x: Math.round(x as number),
        y: Math.round(y as number),
        rotation: 0,
        elevation: (elevation as number) || 0,
        parentSurfaceId: (parentSurfaceId as string) || null,
      };
      currentRoom.furniture.push(newItem);
      db.addFurniture(player.room, newItem).catch(() => {});
      rooms.broadcast(player.room, { type: 'FURNITURE_ADDED', payload: { item: newItem } });
      break;
    }

    case 'REMOVE_FURNITURE': {
      // Only allow removing furniture from the player's OWN personal sanctuary loft
      const playerLoftId = getUserLoftRoomId(player.id);
      if (player.room !== playerLoftId) {
        rooms.send(player.ws, {
          type: 'FURNITURE_ERROR',
          payload: { message: 'Furniture can only be removed from your own Personal Sanctuary Loft!' }
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
      // Only allow clearing the player's OWN personal sanctuary loft
      const playerLoftId = getUserLoftRoomId(player.id);
      if (player.room !== playerLoftId) return;
      const removed = rooms.clearFurniture(player.room);
      for (const f of removed) {
        db.removeFurniture(f.id).catch(() => {});
      }
      rooms.broadcast(player.room, { type: 'ROOM_CLEARED', payload: null });
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
      const reward = Math.max(50, Math.min(500, Math.floor((msg.payload!.score as number) / 2)));
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
        payload: { items: SHOP_ITEMS }
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
      const item = SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS];
      if (!item) {
        rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Item not found in shop!' } });
        return;
      }
      if (player.coins < item.price) {
        rooms.send(player.ws, { type: 'SHOP_ERROR', payload: { message: 'Not enough HavenCoins!' } });
        return;
      }
      player.coins -= item.price;
      db.addCoins(player.id, -item.price).catch(() => {});
      db.addItem(player.id, itemKey, 1).catch(() => {});
      Promise.all([db.getInventory(player.id)]).then(([inventory]) => {
        rooms.send(player.ws, { type: 'COINS_UPDATED', payload: { coins: player.coins, earned: 0, reason: `Bought ${item.name}` } });
        rooms.send(player.ws, { type: 'INVENTORY_UPDATE', payload: { items: inventory } });
      });
      break;
    }

    case 'SELL_ITEM': {
      const itemType = msg.payload!.itemType as string;
      const sellQty = msg.payload!.quantity as number;
      const item = SHOP_ITEMS[itemType as keyof typeof SHOP_ITEMS];
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

    // --- Friends System ---

    case 'GET_FRIENDS_LIST': {
      Promise.all([db.getFriends(player.id), db.getPendingFriendRequests(player.id)]).then(([friends, pendingRequests]) => {
        rooms.send(player.ws, {
          type: 'FRIENDS_LIST_UPDATE',
          payload: { friends, pendingRequests }
        });
      });
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
      const personalLofts: { id: string; ownerId: string; ownerName: string; name: string; count: number }[] = [];
      if (ctx.globalPlayers) {
        for (const [_, p] of ctx.globalPlayers) {
          const loftId = getUserLoftRoomId(p.id);
          const loft = rooms.get(loftId);
          if (loft) {
            personalLofts.push({
              id: loftId,
              ownerId: p.id,
              ownerName: p.name,
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
