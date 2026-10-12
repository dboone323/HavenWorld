import { prisma } from '../prisma';
import { redisClient } from '../redis';

export interface EmoteAnimationDescriptor {
  durationMs: number;
  isLoop: boolean;
  particleEffect?: string;
  soundKey?: string;
}

export interface EmoteInfo {
  id: string;
  name: string;
  category: 'BASE' | 'ADVANCED' | 'MASTERY';
  unlocked: boolean;
  requirementDescription: string;
  animation: EmoteAnimationDescriptor;
}

export const EMOTE_ANIMATIONS: Record<string, EmoteAnimationDescriptor> = {
  wave: { durationMs: 1200, isLoop: false, soundKey: 'emote_wave' },
  jump: { durationMs: 800, isLoop: false, soundKey: 'emote_jump' },
  dance: { durationMs: 3000, isLoop: true, soundKey: 'emote_dance' },
  hug: { durationMs: 1500, isLoop: false, soundKey: 'emote_hug' },
  bow: { durationMs: 1400, isLoop: false, soundKey: 'emote_bow' },
  laugh: { durationMs: 1800, isLoop: false, soundKey: 'emote_laugh' },
  backflip: {
    durationMs: 1000,
    isLoop: false,
    particleEffect: 'acrobatic_sparks',
    soundKey: 'emote_backflip',
  },
  handstand: {
    durationMs: 2500,
    isLoop: true,
    particleEffect: 'balance_dust',
    soundKey: 'emote_handstand',
  },
  confetti: {
    durationMs: 2000,
    isLoop: false,
    particleEffect: 'confetti_blast',
    soundKey: 'emote_confetti',
  },
  sparkle: {
    durationMs: 2200,
    isLoop: false,
    particleEffect: 'star_glitter',
    soundKey: 'emote_sparkle',
  },
};

export const DEFAULT_EMOTE_WHEEL = ['wave', 'jump', 'dance', 'hug', 'bow', 'laugh'];

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
    const hasSparkle = user.isVIP || user._count.achievements >= 5;

    return [
      {
        id: 'wave',
        name: 'Wave',
        category: 'BASE',
        unlocked: true,
        requirementDescription: 'Default emote',
        animation: EMOTE_ANIMATIONS.wave,
      },
      {
        id: 'jump',
        name: 'Jump',
        category: 'BASE',
        unlocked: true,
        requirementDescription: 'Default emote',
        animation: EMOTE_ANIMATIONS.jump,
      },
      {
        id: 'dance',
        name: 'Dance',
        category: 'BASE',
        unlocked: true,
        requirementDescription: 'Default emote',
        animation: EMOTE_ANIMATIONS.dance,
      },
      {
        id: 'hug',
        name: 'Hug',
        category: 'BASE',
        unlocked: true,
        requirementDescription: 'Default emote',
        animation: EMOTE_ANIMATIONS.hug,
      },
      {
        id: 'bow',
        name: 'Polite Bow',
        category: 'BASE',
        unlocked: true,
        requirementDescription: 'Default emote',
        animation: EMOTE_ANIMATIONS.bow,
      },
      {
        id: 'laugh',
        name: 'Hearty Laugh',
        category: 'BASE',
        unlocked: true,
        requirementDescription: 'Default emote',
        animation: EMOTE_ANIMATIONS.laugh,
      },
      {
        id: 'backflip',
        name: 'Acrobatic Backflip',
        category: 'ADVANCED',
        unlocked: hasBackflip,
        requirementDescription: 'Catch 5 fish or unlock 2 achievements',
        animation: EMOTE_ANIMATIONS.backflip,
      },
      {
        id: 'handstand',
        name: 'Handstand Balance',
        category: 'ADVANCED',
        unlocked: hasHandstand,
        requirementDescription: 'Complete 3 pizza minigame shifts',
        animation: EMOTE_ANIMATIONS.handstand,
      },
      {
        id: 'confetti',
        name: 'Party Confetti Blast',
        category: 'MASTERY',
        unlocked: hasConfetti,
        requirementDescription: 'VIP status or maintain 500+ HavenCoins',
        animation: EMOTE_ANIMATIONS.confetti,
      },
      {
        id: 'sparkle',
        name: 'Sparkle Shower',
        category: 'MASTERY',
        unlocked: hasSparkle,
        requirementDescription: 'VIP status or unlock 5 achievements',
        animation: EMOTE_ANIMATIONS.sparkle,
      },
    ];
  }

  /**
   * Retrieves player's equipped emote wheel (up to 8 slots)
   */
  static async getEmoteWheel(userId: string): Promise<string[]> {
    if (redisClient.isOpen) {
      const raw = await redisClient.get(`user:emote_wheel:${userId}`);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        } catch {
          /* ignore */
        }
      }
    }
    return [...DEFAULT_EMOTE_WHEEL];
  }

  /**
   * Customizes player's 8-slot emote wheel with unlock validation
   */
  static async setEmoteWheel(userId: string, slots: string[]): Promise<string[]> {
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > 8) {
      throw new Error('Emote wheel must contain between 1 and 8 emote slots');
    }

    const available = await this.getPlayerEmotes(userId);
    const unlockedMap = new Map<string, boolean>(available.map((e) => [e.id, e.unlocked]));

    for (const emoteId of slots) {
      if (!unlockedMap.has(emoteId)) {
        throw new Error(`Unknown emote: "${emoteId}"`);
      }
      if (!unlockedMap.get(emoteId)) {
        const item = available.find((e) => e.id === emoteId);
        throw new Error(
          `Cannot equip locked emote "${item?.name || emoteId}". Requirement: ${item?.requirementDescription}`
        );
      }
    }

    if (redisClient.isOpen) {
      await redisClient.set(`user:emote_wheel:${userId}`, JSON.stringify(slots));
    }

    return slots;
  }

  /**
   * Validates and returns animation descriptor for triggered emote
   */
  static async validateEmoteTrigger(userId: string, emoteId: string) {
    const emotes = await this.getPlayerEmotes(userId);
    const match = emotes.find((e) => e.id === emoteId);

    if (!match) {
      throw new Error(`Unknown emote: "${emoteId}"`);
    }
    if (!match.unlocked) {
      throw new Error(`Emote "${match.name}" is locked: ${match.requirementDescription}`);
    }

    return {
      emoteId: match.id,
      name: match.name,
      animation: match.animation,
    };
  }
}
