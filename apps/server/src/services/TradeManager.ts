import { prisma } from '../prisma';
import { roomManager } from './RoomManager';
import { getIO } from '../sockets';
import { SOCKET_EVENTS, TradeOfferItem, TradeStateData } from '@havenworld/shared';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

interface ActiveTradeSession {
  id: string;
  initiatorId: string;
  receiverId: string;
  roomId: string;
  initiatorItems: TradeOfferItem[];
  receiverItems: TradeOfferItem[];
  initiatorCoins: number;
  receiverCoins: number;
  initiatorReady: boolean;
  receiverReady: boolean;
  initiatorConfirmed: boolean;
  receiverConfirmed: boolean;
  state: 'OFFER_PHASE' | 'LOCKED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  countdownTimer?: NodeJS.Timeout;
}

export class TradeManager {
  private static sessions = new Map<string, ActiveTradeSession>(); // tradeId -> session
  private static userActiveTrades = new Map<string, string>(); // userId -> tradeId
  private static tradeCooldowns = new Map<string, number>(); // "userA:userB" -> timestamp

  /**
   * Request a trade with a nearby player
   */
  static requestTrade(initiatorId: string, receiverId: string) {
    if (initiatorId === receiverId) {
      throw new Error('You cannot trade with yourself');
    }

    if (this.userActiveTrades.has(initiatorId) || this.userActiveTrades.has(receiverId)) {
      throw new Error('One of the players is already in an active trade');
    }

    // Cooldown check (30s between same pair)
    const pairKey = [initiatorId, receiverId].sort().join(':');
    const lastTrade = this.tradeCooldowns.get(pairKey) || 0;
    if (Date.now() - lastTrade < 30_000) {
      const waitSec = Math.ceil((30_000 - (Date.now() - lastTrade)) / 1000);
      throw new Error(`Please wait ${waitSec}s before trading with this player again`);
    }

    // Proximity check using RoomManager
    const playerA = roomManager.getPlayer(initiatorId);
    const playerB = roomManager.getPlayer(receiverId);

    if (!playerA || !playerB || playerA.roomId !== playerB.roomId) {
      throw new Error('Both players must be in the same room to trade');
    }

    const dist = Math.hypot(playerA.x - playerB.x, (playerA.z ?? 0) - (playerB.z ?? 0));
    if (dist > 4.5) { // within 3-4 tiles / meters
      throw new Error('You are too far away from the other player to trade');
    }

    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const session: ActiveTradeSession = {
      id: tradeId,
      initiatorId,
      receiverId,
      roomId: playerA.roomId,
      initiatorItems: [],
      receiverItems: [],
      initiatorCoins: 0,
      receiverCoins: 0,
      initiatorReady: false,
      receiverReady: false,
      initiatorConfirmed: false,
      receiverConfirmed: false,
      state: 'OFFER_PHASE',
    };

    this.sessions.set(tradeId, session);
    this.userActiveTrades.set(initiatorId, tradeId);
    this.userActiveTrades.set(receiverId, tradeId);

    const io = getIO();
    if (io) {
      io.to(`user:${receiverId}`).emit(SOCKET_EVENTS.TRADE_REQUESTED, {
        tradeId,
        initiatorId,
        initiatorName: playerA.username,
      });
    }

    return session;
  }

  /**
   * Accepts trade request
   */
  static acceptTrade(userId: string) {
    const tradeId = this.userActiveTrades.get(userId);
    if (!tradeId) return;

    const session = this.sessions.get(tradeId);
    if (!session || session.receiverId !== userId) return;

    this.broadcastState(session);
  }

  /**
   * Declines or cancels trade
   */
  static cancelTrade(userId: string, reason = 'Trade cancelled by player') {
    const tradeId = this.userActiveTrades.get(userId);
    if (!tradeId) return;

    const session = this.sessions.get(tradeId);
    if (!session) return;

    if (session.countdownTimer) clearTimeout(session.countdownTimer);

    session.state = 'CANCELLED';
    this.userActiveTrades.delete(session.initiatorId);
    this.userActiveTrades.delete(session.receiverId);
    this.sessions.delete(tradeId);

    const io = getIO();
    if (io) {
      io.to(`user:${session.initiatorId}`).emit(SOCKET_EVENTS.TRADE_CANCELLED, { reason });
      io.to(`user:${session.receiverId}`).emit(SOCKET_EVENTS.TRADE_CANCELLED, { reason });
    }
  }

  /**
   * Modifies an item slot in the offer (Anti-scam: resets ready states!)
   */
  static offerItem(userId: string, slotIndex: number, inventoryItemId: string, itemName: string, assetUrl?: string) {
    const session = this.getSessionForUser(userId);
    if (!session || session.state === 'LOCKED' || session.state === 'COMPLETED') return;

    // Reset both ready states upon offer alteration
    session.initiatorReady = false;
    session.receiverReady = false;

    const isInitiator = session.initiatorId === userId;
    const items = isInitiator ? session.initiatorItems : session.receiverItems;

    // Filter out previous item at this slot
    const filtered = items.filter((i) => i.slotIndex !== slotIndex);
    if (inventoryItemId) {
      filtered.push({ slotIndex, inventoryItemId, name: itemName, assetUrl });
    }

    if (isInitiator) session.initiatorItems = filtered;
    else session.receiverItems = filtered;

    this.broadcastState(session);
  }

  /**
   * Offers HavenCoins in the trade (Anti-scam: resets ready states!)
   */
  static offerCoins(userId: string, amount: number) {
    const session = this.getSessionForUser(userId);
    if (!session || session.state === 'LOCKED' || session.state === 'COMPLETED') return;

    session.initiatorReady = false;
    session.receiverReady = false;

    const clamped = Math.max(0, Math.min(9999, Math.floor(amount || 0)));
    if (session.initiatorId === userId) {
      session.initiatorCoins = clamped;
    } else {
      session.receiverCoins = clamped;
    }

    this.broadcastState(session);
  }

  /**
   * Locks offers into stage 1 (Ready)
   */
  static setReady(userId: string) {
    const session = this.getSessionForUser(userId);
    if (!session || session.state !== 'OFFER_PHASE') return;

    if (session.initiatorId === userId) session.initiatorReady = true;
    else session.receiverReady = true;

    // Both clicked ready -> lock offers and start 5-second countdown
    if (session.initiatorReady && session.receiverReady) {
      session.state = 'LOCKED';
      this.startCountdown(session);
    }

    this.broadcastState(session);
  }

  private static startCountdown(session: ActiveTradeSession) {
    let secondsLeft = 5;
    const io = getIO();

    session.countdownTimer = setInterval(() => {
      secondsLeft--;
      if (io) {
        io.to(`user:${session.initiatorId}`).emit(SOCKET_EVENTS.TRADE_COUNTDOWN, { seconds: secondsLeft });
        io.to(`user:${session.receiverId}`).emit(SOCKET_EVENTS.TRADE_COUNTDOWN, { seconds: secondsLeft });
      }

      if (secondsLeft <= 0) {
        if (session.countdownTimer) clearInterval(session.countdownTimer);
      }
    }, 1000);
  }

  /**
   * Stage 2: Final confirmation
   */
  static async confirmTrade(userId: string) {
    const session = this.getSessionForUser(userId);
    if (!session || session.state !== 'LOCKED') return;

    if (session.initiatorId === userId) session.initiatorConfirmed = true;
    else session.receiverConfirmed = true;

    if (session.initiatorConfirmed && session.receiverConfirmed) {
      session.state = 'CONFIRMED';
      if (session.countdownTimer) clearInterval(session.countdownTimer);
      await this.executeAtomicSwap(session);
    } else {
      this.broadcastState(session);
    }
  }

  /**
   * Executes atomic swap via Prisma $transaction
   */
  private static async executeAtomicSwap(session: ActiveTradeSession) {
    const { initiatorId, receiverId, initiatorItems, receiverItems, initiatorCoins, receiverCoins } = session;

    try {
      await prisma.$transaction(async (tx) => {
        const userA = await tx.user.findUnique({ where: { id: initiatorId } });
        const userB = await tx.user.findUnique({ where: { id: receiverId } });

        if (!userA || !userB) throw new Error('User not found');
        if (userA.havenCoins < initiatorCoins) throw new Error(`${userA.username} has insufficient coins`);
        if (userB.havenCoins < receiverCoins) throw new Error(`${userB.username} has insufficient coins`);

        // Swap coins
        if (initiatorCoins > 0) {
          await tx.user.update({ where: { id: initiatorId }, data: { havenCoins: { decrement: initiatorCoins } } });
          await tx.user.update({ where: { id: receiverId }, data: { havenCoins: { increment: initiatorCoins } } });
        }
        if (receiverCoins > 0) {
          await tx.user.update({ where: { id: receiverId }, data: { havenCoins: { decrement: receiverCoins } } });
          await tx.user.update({ where: { id: initiatorId }, data: { havenCoins: { increment: receiverCoins } } });
        }

        // Swap initiator items -> receiver
        for (const item of initiatorItems) {
          const inv = await tx.inventory.findUnique({
            where: { userId_itemId: { userId: initiatorId, itemId: item.inventoryItemId } },
          });
          if (!inv || inv.quantity < 1) throw new Error(`Initiator missing item ${item.name}`);

          if (inv.quantity === 1) await tx.inventory.delete({ where: { id: inv.id } });
          else await tx.inventory.update({ where: { id: inv.id }, data: { quantity: { decrement: 1 } } });

          await tx.inventory.upsert({
            where: { userId_itemId: { userId: receiverId, itemId: item.inventoryItemId } },
            create: { userId: receiverId, itemId: item.inventoryItemId, quantity: 1 },
            update: { quantity: { increment: 1 } },
          });
        }

        // Swap receiver items -> initiator
        for (const item of receiverItems) {
          const inv = await tx.inventory.findUnique({
            where: { userId_itemId: { userId: receiverId, itemId: item.inventoryItemId } },
          });
          if (!inv || inv.quantity < 1) throw new Error(`Receiver missing item ${item.name}`);

          if (inv.quantity === 1) await tx.inventory.delete({ where: { id: inv.id } });
          else await tx.inventory.update({ where: { id: inv.id }, data: { quantity: { decrement: 1 } } });

          await tx.inventory.upsert({
            where: { userId_itemId: { userId: initiatorId, itemId: item.inventoryItemId } },
            create: { userId: initiatorId, itemId: item.inventoryItemId, quantity: 1 },
            update: { quantity: { increment: 1 } },
          });
        }

        // Audit Log
        await tx.tradeLog.create({
          data: {
            initiatorId,
            receiverId,
            initiatorItems: initiatorItems as any,
            receiverItems: receiverItems as any,
            initiatorCoins,
            receiverCoins,
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      });

      session.state = 'COMPLETED';
      const pairKey = [initiatorId, receiverId].sort().join(':');
      this.tradeCooldowns.set(pairKey, Date.now());

      this.userActiveTrades.delete(initiatorId);
      this.userActiveTrades.delete(receiverId);
      this.sessions.delete(session.id);

      const io = getIO();
      if (io) {
        io.to(`user:${initiatorId}`).emit(SOCKET_EVENTS.TRADE_COMPLETE, { summary: 'Trade completed successfully!' });
        io.to(`user:${receiverId}`).emit(SOCKET_EVENTS.TRADE_COMPLETE, { summary: 'Trade completed successfully!' });
      }

      await QuestService.incrementProgress(initiatorId, 'P2P_TRADE', 1);
      await QuestService.incrementProgress(receiverId, 'P2P_TRADE', 1);
      await AchievementService.checkAndAward(initiatorId, 'P2P_TRADE');
      await AchievementService.checkAndAward(receiverId, 'P2P_TRADE');
    } catch (err: any) {
      console.error('[TradeManager] Swap failed:', err);
      this.cancelTrade(initiatorId, err?.message || 'Trade swap failed');
    }
  }

  private static broadcastState(session: ActiveTradeSession) {
    const io = getIO();
    if (!io) return;

    const payload: TradeStateData = {
      tradeId: session.id,
      initiatorId: session.initiatorId,
      receiverId: session.receiverId,
      initiatorItems: session.initiatorItems,
      receiverItems: session.receiverItems,
      initiatorCoins: session.initiatorCoins,
      receiverCoins: session.receiverCoins,
      initiatorReady: session.initiatorReady,
      receiverReady: session.receiverReady,
      initiatorConfirmed: session.initiatorConfirmed,
      receiverConfirmed: session.receiverConfirmed,
      state: session.state,
    };

    io.to(`user:${session.initiatorId}`).emit(SOCKET_EVENTS.TRADE_STATE_UPDATE, payload);
    io.to(`user:${session.receiverId}`).emit(SOCKET_EVENTS.TRADE_STATE_UPDATE, payload);
  }

  private static getSessionForUser(userId: string) {
    const tradeId = this.userActiveTrades.get(userId);
    return tradeId ? this.sessions.get(tradeId) : undefined;
  }
}
