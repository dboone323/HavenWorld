import { prisma } from '../prisma';
import { captureSecurityEvent } from '../monitoring/sentry';

export const MAX_WEEKLY_EARNINGS_CAP = 500;

export interface TransferResult {
  success: boolean;
  senderBalance: number;
  receiverBalance: number;
  transactionId: string;
}

export interface RewardResult {
  success: boolean;
  newBalance: number;
  weeklyEarnings: number;
  transactionId: string;
}

export class EconomySecurity {
  /**
   * Atomic coin transfer between two users with strict validation:
   * 1. Positive integer amounts only (prevents negative transfer exploit)
   * 2. Sender != Receiver (prevents infinite loop/race conditions)
   * 3. Read & verify balance inside $transaction (prevents double-spending)
   * 4. Audit trail logged in TransactionLog
   */
  public static async transferCoins(
    fromUserId: string,
    toUserId: string,
    amount: number,
    reason: string = 'PLAYER_TRANSFER'
  ): Promise<TransferResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      captureSecurityEvent('ECONOMY_ANOMALY', {
        userId: fromUserId,
        details: { action: 'transferCoins', invalidAmount: amount, toUserId },
      });
      throw new Error('INVALID_AMOUNT: Transfer amount must be a positive integer.');
    }

    if (fromUserId === toUserId) {
      throw new Error('INVALID_TRANSFER: Cannot transfer coins to yourself.');
    }

    return await prisma.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({
        where: { id: fromUserId },
        select: { id: true, havenCoins: true, isBanned: true },
      });

      if (!sender || sender.isBanned) {
        throw new Error('SENDER_UNAVAILABLE: Sender account does not exist or is suspended.');
      }

      if (sender.havenCoins < amount) {
        throw new Error('INSUFFICIENT_FUNDS: Sender does not have enough coins.');
      }

      const receiver = await tx.user.findUnique({
        where: { id: toUserId },
        select: { id: true, havenCoins: true, isBanned: true },
      });

      if (!receiver || receiver.isBanned) {
        throw new Error('RECEIVER_UNAVAILABLE: Receiver account does not exist or is suspended.');
      }

      const updatedSender = await tx.user.update({
        where: { id: fromUserId },
        data: { havenCoins: { decrement: amount } },
        select: { havenCoins: true },
      });

      const updatedReceiver = await tx.user.update({
        where: { id: toUserId },
        data: { havenCoins: { increment: amount } },
        select: { havenCoins: true },
      });

      const log = await tx.transactionLog.create({
        data: {
          senderId: fromUserId,
          receiverId: toUserId,
          amount,
          type: 'TRANSFER',
          source: reason,
        },
      });

      return {
        success: true,
        senderBalance: updatedSender.havenCoins,
        receiverBalance: updatedReceiver.havenCoins,
        transactionId: log.id,
      };
    });
  }

  /**
   * Atomic reward distribution with weekly cap enforcement:
   * Prevents botting/farming inflation by capping weekly non-purchase earnings to 500 coins.
   */
  public static async awardReward(
    userId: string,
    amount: number,
    reason: string = 'GAMEPLAY_REWARD'
  ): Promise<RewardResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('INVALID_AMOUNT: Reward amount must be a positive integer.');
    }

    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, havenCoins: true, weeklyEarnings: true, isBanned: true },
      });

      if (!user || user.isBanned) {
        throw new Error('USER_UNAVAILABLE: Account does not exist or is suspended.');
      }

      const currentWeekly = user.weeklyEarnings ?? 0;
      if (currentWeekly + amount > MAX_WEEKLY_EARNINGS_CAP) {
        captureSecurityEvent('ECONOMY_ANOMALY', {
          userId,
          details: {
            action: 'awardReward_cap_exceeded',
            currentWeekly,
            requestedReward: amount,
            cap: MAX_WEEKLY_EARNINGS_CAP,
          },
        });
        throw new Error(
          `WEEKLY_CAP_EXCEEDED: Maximum earnings cap of ${MAX_WEEKLY_EARNINGS_CAP} reached for this week.`
        );
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          havenCoins: { increment: amount },
          weeklyEarnings: { increment: amount },
        },
        select: { havenCoins: true, weeklyEarnings: true },
      });

      const log = await tx.transactionLog.create({
        data: {
          receiverId: userId,
          amount,
          type: 'REWARD',
          source: reason,
        },
      });

      return {
        success: true,
        newBalance: updated.havenCoins,
        weeklyEarnings: updated.weeklyEarnings,
        transactionId: log.id,
      };
    });
  }

  /**
   * Track 4.2 Dual Currency Model: Atomic HavenGems award.
   * Gems are earned strictly through long-term achievement stamps, milestone rewards, and weekly events.
   */
  public static async awardGems(
    userId: string,
    amount: number,
    reason: string = 'ACHIEVEMENT_GEMS'
  ): Promise<{ success: boolean; newGemBalance: number; transactionId: string }> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('INVALID_AMOUNT: Gem amount must be a positive integer.');
    }

    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, havenGems: true, isBanned: true },
      });

      if (!user || user.isBanned) {
        throw new Error('USER_UNAVAILABLE: Account does not exist or is suspended.');
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { havenGems: { increment: amount } },
        select: { havenGems: true },
      });

      const log = await tx.transactionLog.create({
        data: {
          receiverId: userId,
          amount,
          type: 'REWARD',
          source: `GEMS:${reason}`,
        },
      });

      return {
        success: true,
        newGemBalance: updated.havenGems,
        transactionId: log.id,
      };
    });
  }
}

