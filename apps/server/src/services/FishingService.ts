import { prisma } from '../prisma';
import { AnalyticsService } from './AnalyticsService';
import { FISH_CATALOG, FISHING_CONSTANTS, FishSpecies } from '@havenworld/shared';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

interface ActiveFishingSession {
  userId: string;
  roomId: string;
  fish: FishSpecies;
  weightLbs: number;
  currentTension: number; // 0.0 to 1.0
  sweetSpotCenter: number;// 0.0 to 1.0
  sweetSpotWidth: number; // 0.25 standard
  playerReelPos: number;  // 0.0 to 1.0
  rageRunsRemaining: number;
  isRaging: boolean;
  intervalTimer: NodeJS.Timeout | null;
}

export class FishingService {
  private static activeSessions = new Map<string, ActiveFishingSession>();

  /**
   * Selects a fish based on weighted rarity probabilities
   */
  private static pickRandomFish(): FishSpecies {
    const roll = Math.random() * 100;
    let targetRarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';

    if (roll < 55) targetRarity = 'COMMON';
    else if (roll < 85) targetRarity = 'UNCOMMON';
    else if (roll < 97) targetRarity = 'RARE';
    else targetRarity = 'LEGENDARY';

    const candidates = FISH_CATALOG.filter((f) => f.rarity === targetRarity);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)] || FISH_CATALOG[0];
    return chosen;
  }

  /**
   * Starts a fishing session when player casts line
   */
  static startSession(userId: string, roomId: string) {
    this.cancelSession(userId);

    const fish = this.pickRandomFish();
    const weightLbs = parseFloat(
      (fish.minWeight + Math.random() * (fish.maxWeight - fish.minWeight)).toFixed(2)
    );

    const session: ActiveFishingSession = {
      userId,
      roomId,
      fish,
      weightLbs,
      currentTension: 0.35, // starting tension
      sweetSpotCenter: 0.5,
      sweetSpotWidth: 0.25,
      playerReelPos: 0.5,
      rageRunsRemaining: fish.rageRuns,
      isRaging: false,
      intervalTimer: null,
    };

    this.activeSessions.set(userId, session);

    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit(SOCKET_EVENTS.FISH_BITE, {
        species: fish.name,
        difficulty: fish.rarity,
        rageRuns: fish.rageRuns,
      });
    }

    // 10 Hz simulation loop
    session.intervalTimer = setInterval(() => {
      this.tickSession(userId);
    }, FISHING_CONSTANTS.TICK_RATE_MS);
  }

  /**
   * Updates player's current reel position (0.0 to 1.0)
   */
  static updateReelPosition(userId: string, position: number) {
    const session = this.activeSessions.get(userId);
    if (session) {
      session.playerReelPos = Math.max(0, Math.min(1, position));
    }
  }

  /**
   * Simulation tick (100ms)
   */
  private static async tickSession(userId: string) {
    const session = this.activeSessions.get(userId);
    if (!session) return;

    // Sweet spot wandering
    const wanderDelta = (Math.random() - 0.5) * 0.08;
    session.sweetSpotCenter = Math.max(
      session.sweetSpotWidth / 2,
      Math.min(1 - session.sweetSpotWidth / 2, session.sweetSpotCenter + wanderDelta)
    );

    const sweetSpotMin = session.sweetSpotCenter - session.sweetSpotWidth / 2;
    const sweetSpotMax = session.sweetSpotCenter + session.sweetSpotWidth / 2;

    const isInside =
      session.playerReelPos >= sweetSpotMin && session.playerReelPos <= sweetSpotMax;

    if (isInside) {
      session.currentTension += FISHING_CONSTANTS.SWEET_SPOT_GAIN_PER_SEC * 0.1;
    } else {
      session.currentTension -= FISHING_CONSTANTS.TENSION_DRAIN_PER_SEC * 0.1;
    }

    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit(SOCKET_EVENTS.TENSION_UPDATE, {
        value: parseFloat(session.currentTension.toFixed(3)),
        sweetSpotMin: parseFloat(sweetSpotMin.toFixed(3)),
        sweetSpotMax: parseFloat(sweetSpotMax.toFixed(3)),
      });
    }

    // Win condition: tension reaches target win (1.0)
    if (session.currentTension >= FISHING_CONSTANTS.TARGET_TENSION_WIN) {
      this.endSessionSuccess(session);
    } else if (session.currentTension <= 0) {
      // Lose condition: fish got away
      this.endSessionFail(session);
    }
  }

  private static async endSessionSuccess(session: ActiveFishingSession) {
    this.cancelSession(session.userId);

    const coinMultiplier = 1 + (session.weightLbs / session.fish.maxWeight) * 0.5;
    const coins = Math.round(session.fish.baseCoinReward * coinMultiplier);
    const isRare = session.fish.rarity === 'RARE' || session.fish.rarity === 'LEGENDARY';

    try {
      // Record catch
      await prisma.fishCatch.create({
        data: {
          userId: session.userId,
          species: session.fish.name,
          weightLbs: session.weightLbs,
          coinsEarned: coins,
        },
      });

      // Award coins to player
      await prisma.user.update({
        where: { id: session.userId },
        data: { havenCoins: { increment: coins } },
      });

      // Update weekly leaderboard
      const startOfWeek = new Date();
      startOfWeek.setUTCHours(0, 0, 0, 0);
      startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());

      await prisma.fishingLeaderboard.upsert({
        where: {
          userId_weekOf: {
            userId: session.userId,
            weekOf: startOfWeek,
          },
        },
        create: {
          userId: session.userId,
          species: session.fish.name,
          weightLbs: session.weightLbs,
          weekOf: startOfWeek,
        },
        update: {
          weightLbs: { set: session.weightLbs },
          species: session.fish.name,
        },
      });

      // Notify user
      const io = getIO();
      if (io) {
        io.to(`user:${session.userId}`).emit(SOCKET_EVENTS.FISH_CAUGHT, {
          species: session.fish.name,
          weight: session.weightLbs,
          coins,
          coinsEarned: coins,
          isRare,
        });
      }

      // Track daily quest & achievements
      void AnalyticsService.trackEvent('FISH_CAUGHT', {
        userId: session.userId,
        roomId: session.roomId,
        payload: { species: session.fish.name, weight: session.weightLbs, coins },
      });

      await QuestService.incrementProgress(session.userId, 'CATCH_FISH', 1);
      await AchievementService.checkAndAward(session.userId, 'CATCH_FISH', {
        species: session.fish.id,
        weight: session.weightLbs,
      });
    } catch (err) {
      console.error('[FishingService] Error recording catch:', err);
    }
  }

  private static endSessionFail(session: ActiveFishingSession) {
    this.cancelSession(session.userId);

    const io = getIO();
    if (io) {
      io.to(`user:${session.userId}`).emit(SOCKET_EVENTS.FISH_ESCAPED, {
        escaped: true,
        reason: 'LOST_TENSION',
      });
    }
  }

  static cancelSession(userId: string) {
    const session = this.activeSessions.get(userId);
    if (session) {
      if (session.intervalTimer) clearInterval(session.intervalTimer);
      this.activeSessions.delete(userId);
    }
  }

  /**
   * Fetches the top 10 catches for the current week
   */
  static async getWeeklyLeaderboard() {
    const startOfWeek = new Date();
    startOfWeek.setUTCHours(0, 0, 0, 0);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());

    return await prisma.fishingLeaderboard.findMany({
      where: { weekOf: startOfWeek },
      orderBy: { weightLbs: 'desc' },
      take: 10,
      include: {
        user: { select: { id: true, username: true } },
      },
    });
  }

  /**
   * Resets the weekly leaderboard: rewards top 3 fishers and archives/clears
   */
  static async resetWeeklyLeaderboard(): Promise<void> {
    try {
      const topCatches = await this.getWeeklyLeaderboard();
      if (topCatches.length > 0) {
        // Award prize coins to top 3
        const prizes = [500, 250, 100];
        for (let i = 0; i < Math.min(topCatches.length, 3); i++) {
          const winner = topCatches[i];
          const prize = prizes[i];
          await prisma.user.update({
            where: { id: winner.userId },
            data: { havenCoins: { increment: prize } },
          });
        }
      }

      // Reset leaderboard entries for the upcoming week
      const startOfWeek = new Date();
      startOfWeek.setUTCHours(0, 0, 0, 0);
      startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());

      await prisma.fishingLeaderboard.deleteMany({
        where: {
          weekOf: { lt: startOfWeek },
        },
      });
      console.log('[FishingService] Weekly leaderboard reset successfully');
    } catch (err) {
      console.error('[FishingService] Error resetting weekly leaderboard:', err);
    }
  }
}
