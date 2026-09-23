import { prisma } from '../prisma';

export interface EmoteInfo {
  id: string;
  name: string;
  category: 'BASE' | 'ADVANCED' | 'MASTERY';
  unlocked: boolean;
  requirementDescription: string;
}

export class EmoteProgressionService {
  /**
   * Evaluates player profile to determine unlocked emote expressions
   */
  static async getPlayerEmotes(userId: string): Promise<EmoteInfo[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            achievements: true,
            fishCatches: true,
            minigameSessions: true,
          },
        },
      },
    });

    if (!user) throw new Error('User not found');

    const hasBackflip = user._count.fishCatches >= 5 || user._count.achievements >= 2;
    const hasHandstand = user._count.minigameSessions >= 3;
    const hasConfetti = user.isVIP || user.havenCoins >= 500;

    return [
      { id: 'wave', name: 'Wave', category: 'BASE', unlocked: true, requirementDescription: 'Default emote' },
      { id: 'jump', name: 'Jump', category: 'BASE', unlocked: true, requirementDescription: 'Default emote' },
      { id: 'dance', name: 'Dance', category: 'BASE', unlocked: true, requirementDescription: 'Default emote' },
      { id: 'hug', name: 'Hug', category: 'BASE', unlocked: true, requirementDescription: 'Default emote' },
      {
        id: 'backflip',
        name: 'Acrobatic Backflip',
        category: 'ADVANCED',
        unlocked: hasBackflip,
        requirementDescription: 'Catch 5 fish or unlock 2 achievements',
      },
      {
        id: 'handstand',
        name: 'Handstand Balance',
        category: 'ADVANCED',
        unlocked: hasHandstand,
        requirementDescription: 'Complete 3 pizza minigame shifts',
      },
      {
        id: 'confetti',
        name: 'Party Confetti Blast',
        category: 'MASTERY',
        unlocked: hasConfetti,
        requirementDescription: 'VIP status or maintain 500+ HavenCoins',
      },
    ];
  }
}
