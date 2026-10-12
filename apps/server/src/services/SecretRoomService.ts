import { prisma } from '../prisma';
import { AchievementService } from './AchievementService';

export interface SecretChamber {
  id: string;
  name: string;
  triggerPhrase: string;
  clue: string;
  bountyCoins: number;
}

export const SECRET_CHAMBERS: SecretChamber[] = [
  {
    id: 'room_secret_observatory',
    name: 'The Forgotten Observatory',
    triggerPhrase: 'abracadabra',
    clue: 'Look up toward the ancient starry telescope.',
    bountyCoins: 100,
  },
  {
    id: 'room_secret_cavern',
    name: 'The Whispering Cavern',
    triggerPhrase: 'open sesame',
    clue: 'Behind the cascading crystal waterfall.',
    bountyCoins: 150,
  },
  {
    id: 'room_secret_arcade_84',
    name: 'Retro Arcade 1984',
    triggerPhrase: 'retro arcade 1984',
    clue: 'Insert coin where neon pixels glow.',
    bountyCoins: 200,
  },
  {
    id: 'room_secret_vault',
    name: 'The Haven Vault',
    triggerPhrase: 'haven secret',
    clue: 'Only the relentless explorer unlocks the master vault.',
    bountyCoins: 250,
  },
];

export const SECRET_PASSWORDS = SECRET_CHAMBERS.map((c) => c.triggerPhrase);

export class SecretRoomService {
  /**
   * Returns list of all available secret chambers
   */
  static getChambers(): SecretChamber[] {
    return [...SECRET_CHAMBERS];
  }

  /**
   * Retrieves player's discovered secret rooms
   */
  static async getUserDiscoveries(userId: string): Promise<string[]> {
    const events = await prisma.gameEvent.findMany({
      where: {
        userId,
        event: 'EASTER_EGG_DISCOVERED',
      },
      select: { payload: true },
    });

    const discoveredIds = new Set<string>();
    for (const ev of events) {
      const payload = ev.payload as Record<string, any>;
      if (payload?.chamberId) {
        discoveredIds.add(payload.chamberId);
      }
    }
    return Array.from(discoveredIds);
  }

  /**
   * Evaluates if a spoken chat message triggers entry into a secret chamber
   */
  static async checkSecretTrigger(
    userId: string,
    currentRoomId: string,
    message: string
  ): Promise<{
    triggered: boolean;
    secretRoomId?: string;
    easterEggName?: string;
    isFirstDiscovery?: boolean;
    bountyCoins?: number;
  }> {
    const clean = message.trim().toLowerCase();
    const chamber = SECRET_CHAMBERS.find((c) => clean.includes(c.triggerPhrase));

    if (!chamber) {
      return { triggered: false };
    }

    // Check if player has already discovered this specific chamber
    const priorDiscoveries = await this.getUserDiscoveries(userId);
    const isFirstDiscovery = !priorDiscoveries.includes(chamber.id);

    if (isFirstDiscovery) {
      // Award first-time discovery bounty
      await prisma.$transaction(async (tx) => {
        await tx.gameEvent.create({
          data: {
            event: 'EASTER_EGG_DISCOVERED',
            userId,
            roomId: currentRoomId,
            payload: {
              triggerPhrase: chamber.triggerPhrase,
              chamberId: chamber.id,
              chamberName: chamber.name,
              bountyCoins: chamber.bountyCoins,
            },
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { havenCoins: { increment: chamber.bountyCoins } },
        });

        await tx.transactionLog.create({
          data: {
            receiverId: userId,
            amount: chamber.bountyCoins,
            type: 'SECRET_ROOM_BOUNTY',
            source: chamber.name,
          },
        });
      });

      await AchievementService.checkAndAward(userId, 'DISCOVER_SECRET_ROOM', { roomId: chamber.id });
    }

    return {
      triggered: true,
      secretRoomId: chamber.id,
      easterEggName: chamber.name,
      isFirstDiscovery,
      bountyCoins: isFirstDiscovery ? chamber.bountyCoins : 0,
    };
  }
}
