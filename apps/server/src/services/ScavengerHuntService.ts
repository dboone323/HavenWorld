import crypto from 'crypto';
import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { AnalyticsService } from './AnalyticsService';
import { SeasonalThemeService } from './SeasonalThemeService';

export interface ScavengerTicket {
  id: string;
  roomId: string;
  x: number;
  y: number;
  rewardCoins: number;
  claimedBy: string | null;
  claimedAt: Date | null;
  createdAt: Date;
}

export interface ScavengerHuntClue {
  index: number;
  riddle: string;
  targetRoomId: string;
  solutionToken: string;
  validationHash: string;
}

export interface SeasonalDisbursement {
  season: string;
  coinsAwarded: number;
  achievementKey?: string;
  badge: string;
}

export interface ClueProgressStatus {
  currentClueIndex: number;
  totalClues: number;
  currentClue: Omit<ScavengerHuntClue, 'solutionToken'> | null;
  isCompleted: boolean;
  reward?: SeasonalDisbursement;
}

export class ScavengerHuntService {
  private static readonly SECRET_SALT = 'havenworld_scavenger_season_2026';
  private static tickets = new Map<string, ScavengerTicket>();
  private static userProgress = new Map<string, number>(); // userId -> currentClueIndex (1-indexed)
  private static userCompleted = new Set<string>();

  /**
   * Catalog of sequential riddle clues leading to the seasonal cache
   */
  public static readonly HUNT_CLUES: readonly ScavengerHuntClue[] = [
    {
      index: 1,
      riddle: 'Where the park fountain ripples under the open sky, inspect the eastern mossy stone.',
      targetRoomId: 'room-park',
      solutionToken: 'mossy_stone_alpha',
      validationHash: ScavengerHuntService.generateHash(1, 'room-park', 'mossy_stone_alpha'),
    },
    {
      index: 2,
      riddle: 'In the bustling town square, uncover the brass cog lodged beside the old lamppost.',
      targetRoomId: 'room-town-square',
      solutionToken: 'brass_cog_beta',
      validationHash: ScavengerHuntService.generateHash(2, 'room-town-square', 'brass_cog_beta'),
    },
    {
      index: 3,
      riddle: 'At the tranquil lakeside wharf, search the weather-worn chest tucked under the pier.',
      targetRoomId: 'room-wharf',
      solutionToken: 'pier_chest_omega',
      validationHash: ScavengerHuntService.generateHash(3, 'room-wharf', 'pier_chest_omega'),
    },
  ];

  /**
   * Generates SHA-256 validation hash for a clue step
   */
  static generateHash(index: number, roomId: string, token: string): string {
    return crypto
      .createHash('sha256')
      .update(`${index}:${roomId}:${token}:${this.SECRET_SALT}`)
      .digest('hex');
  }

  /**
   * Returns player's current clue progress
   */
  static getUserProgress(userId: string): ClueProgressStatus {
    const isCompleted = this.userCompleted.has(userId);
    const currentIndex = this.userProgress.get(userId) || 1;

    if (isCompleted || currentIndex > this.HUNT_CLUES.length) {
      return {
        currentClueIndex: this.HUNT_CLUES.length + 1,
        totalClues: this.HUNT_CLUES.length,
        currentClue: null,
        isCompleted: true,
      };
    }

    const clue = this.HUNT_CLUES.find((c) => c.index === currentIndex);
    const sanitizedClue = clue
      ? {
          index: clue.index,
          riddle: clue.riddle,
          targetRoomId: clue.targetRoomId,
          validationHash: clue.validationHash,
        }
      : null;

    return {
      currentClueIndex: currentIndex,
      totalClues: this.HUNT_CLUES.length,
      currentClue: sanitizedClue,
      isCompleted: false,
    };
  }

  /**
   * Validates submitted clue solution token and advances player progression
   */
  static async solveClue(
    userId: string,
    clueIndex: number,
    roomId: string,
    solutionToken: string
  ): Promise<{
    success: boolean;
    nextClueIndex: number;
    isCompleted: boolean;
    reward?: SeasonalDisbursement;
  }> {
    if (this.userCompleted.has(userId)) {
      throw new Error('Seasonal scavenger hunt already completed');
    }

    const currentClueIndex = this.userProgress.get(userId) || 1;
    if (clueIndex !== currentClueIndex) {
      throw new Error(`Expected clue #${currentClueIndex}, but attempted #${clueIndex}`);
    }

    const targetClue = this.HUNT_CLUES.find((c) => c.index === clueIndex);
    if (!targetClue) throw new Error('Clue not found in catalog');

    if (targetClue.targetRoomId !== roomId) {
      throw new Error(`Clue must be solved in ${targetClue.targetRoomId}`);
    }

    // Verify cryptographic validation hash
    const computedHash = this.generateHash(clueIndex, roomId, solutionToken.trim());
    if (computedHash !== targetClue.validationHash) {
      throw new Error('Invalid clue solution token');
    }

    // If final clue, disburse seasonal reward
    if (clueIndex === this.HUNT_CLUES.length) {
      this.userCompleted.add(userId);
      this.userProgress.set(userId, clueIndex + 1);

      const seasonalConfig = SeasonalThemeService.getSeasonalConfig();
      const baseReward = 250;
      const seasonalMultiplier =
        seasonalConfig.season === 'AUTUMN' || seasonalConfig.season === 'WINTER' ? 1.2 : 1.0;
      const totalCoins = Math.round(baseReward * seasonalMultiplier);

      await prisma.user.update({
        where: { id: userId },
        data: { havenCoins: { increment: totalCoins } },
      });

      const reward: SeasonalDisbursement = {
        season: seasonalConfig.season,
        coinsAwarded: totalCoins,
        badge: `${seasonalConfig.season}_SCAVENGER_MASTER`,
        achievementKey: 'SEASONAL_EXPLORER',
      };

      await AnalyticsService.trackEvent('SCAVENGER_HUNT_COMPLETED', {
        userId,
        payload: { cluesCompleted: this.HUNT_CLUES.length, coinsAwarded: totalCoins },
      });

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit('scavenger:hunt_completed', reward);
      }

      return {
        success: true,
        nextClueIndex: clueIndex + 1,
        isCompleted: true,
        reward,
      };
    }

    // Advance to next clue
    const nextIndex = clueIndex + 1;
    this.userProgress.set(userId, nextIndex);

    return {
      success: true,
      nextClueIndex: nextIndex,
      isCompleted: false,
    };
  }

  /**
   * Resets scavenger progression for testing
   */
  static resetForTesting(): void {
    this.tickets.clear();
    this.userProgress.clear();
    this.userCompleted.clear();
  }

  /**
   * Spawns a Golden Ticket collectible at a coordinate in a public room
   */
  static spawnTicket(roomId: string, x: number, y: number, rewardCoins: number = 100): ScavengerTicket {
    const id = `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const ticket: ScavengerTicket = {
      id,
      roomId,
      x,
      y,
      rewardCoins,
      claimedBy: null,
      claimedAt: null,
      createdAt: new Date(),
    };

    this.tickets.set(id, ticket);

    const io = getIO();
    if (io) {
      io.to(roomId).emit('scavenger:spawned', {
        id,
        x,
        y,
        rewardCoins,
      });
    }

    return ticket;
  }

  /**
   * Returns all uncollected tickets (filtered by roomId when provided)
   */
  static getActiveTickets(roomId?: string): ScavengerTicket[] {
    return Array.from(this.tickets.values()).filter(
      (t) => (!roomId || t.roomId === roomId) && t.claimedBy === null
    );
  }

  /**
   * Claims a hidden ticket by proximity
   */
  static async claimTicket(ticketId: string, userId: string, playerX: number, playerY: number) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw new Error('Scavenger ticket not found');
    if (ticket.claimedBy) throw new Error('Ticket has already been claimed');

    // Proximity check (within 2.5 tiles)
    const dist = Math.hypot(playerX - ticket.x, playerY - ticket.y);
    if (dist > 2.5) {
      throw new Error('Too far away from ticket to collect');
    }

    ticket.claimedBy = userId;
    ticket.claimedAt = new Date();

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { havenCoins: { increment: ticket.rewardCoins } },
      select: { id: true, username: true, havenCoins: true },
    });

    const io = getIO();
    if (io) {
      io.to(ticket.roomId).emit('scavenger:claimed', {
        ticketId,
        winnerId: userId,
        winnerName: updatedUser.username,
        rewardCoins: ticket.rewardCoins,
      });
    }

    return {
      ticketId,
      rewardCoins: ticket.rewardCoins,
      userNewBalance: updatedUser.havenCoins,
    };
  }
}
