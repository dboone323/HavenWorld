import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export type DyeSlot = 'topColor' | 'bottomColor' | 'hairColor' | 'eyeColor';

export interface DyePalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  rarity: 'COMMON' | 'RARE' | 'LEGENDARY';
  coinCost: number;
}

export const DYE_PALETTES: Record<string, DyePalette> = {
  NEON_CYBERPUNK: {
    id: 'NEON_CYBERPUNK',
    name: 'Neon Cyberpunk',
    primary: '#00F0FF',
    secondary: '#FF007F',
    accent: '#7928CA',
    rarity: 'LEGENDARY',
    coinCost: 150,
  },
  PASTEL_DREAMS: {
    id: 'PASTEL_DREAMS',
    name: 'Pastel Dreams',
    primary: '#FFD1DC',
    secondary: '#B5EAD7',
    accent: '#C7CEEA',
    rarity: 'RARE',
    coinCost: 100,
  },
  ROYAL_VELVET: {
    id: 'ROYAL_VELVET',
    name: 'Royal Velvet',
    primary: '#4B0082',
    secondary: '#FFD700',
    accent: '#800020',
    rarity: 'LEGENDARY',
    coinCost: 200,
  },
  MIDNIGHT_OBSIDIAN: {
    id: 'MIDNIGHT_OBSIDIAN',
    name: 'Midnight Obsidian',
    primary: '#0D0D0D',
    secondary: '#1A1A2E',
    accent: '#16213E',
    rarity: 'RARE',
    coinCost: 80,
  },
  SOLAR_FLARE: {
    id: 'SOLAR_FLARE',
    name: 'Solar Flare',
    primary: '#FF4500',
    secondary: '#FF8C00',
    accent: '#FFD700',
    rarity: 'COMMON',
    coinCost: 50,
  },
  NATURE_EMERALD: {
    id: 'NATURE_EMERALD',
    name: 'Nature Emerald',
    primary: '#2E8B57',
    secondary: '#006400',
    accent: '#8FBC8F',
    rarity: 'COMMON',
    coinCost: 50,
  },
};

export class DyeService {
  /**
   * Validates standard 6-character hexadecimal color (#RRGGBB)
   */
  static validateHexColor(hex: string): boolean {
    if (!hex || typeof hex !== 'string') return false;
    return /^#([0-9A-Fa-f]{6})$/.test(hex.trim());
  }

  /**
   * Converts #RRGGBB to normalized [0..1] RGB vector for WebGL shader uniforms
   */
  static hexToRgbNormalized(hex: string): [number, number, number] {
    if (!this.validateHexColor(hex)) {
      throw new Error(`Invalid hex color string: "${hex}". Expected format #RRGGBB.`);
    }
    const clean = hex.trim().replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;

    return [
      Math.round(r * 10000) / 10000,
      Math.round(g * 10000) / 10000,
      Math.round(b * 10000) / 10000,
    ];
  }

  /**
   * Converts RGB (0..1) to HSV representation for lighting / saturation math
   */
  static rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (max !== min) {
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100) / 100,
      v: Math.round(v * 100) / 100,
    };
  }

  /**
   * Generates WebGL shader uniform parameters from palette preset or custom hex
   */
  static computePaletteShaderUniforms(paletteKey: string, customHex?: string) {
    const palette = DYE_PALETTES[paletteKey];
    const primaryHex = customHex || palette?.primary || '#FFFFFF';
    const secondaryHex = palette?.secondary || '#888888';
    const accentHex = palette?.accent || '#444444';

    const u_primaryColor = this.hexToRgbNormalized(primaryHex);
    const u_secondaryColor = this.hexToRgbNormalized(secondaryHex);
    const u_accentColor = this.hexToRgbNormalized(accentHex);

    const hsv = this.rgbToHsv(u_primaryColor[0], u_primaryColor[1], u_primaryColor[2]);

    return {
      u_primaryColor,
      u_secondaryColor,
      u_accentColor,
      u_brightness: hsv.v,
      u_saturation: hsv.s,
    };
  }

  /**
   * Returns list of available curated dye palettes
   */
  static getAvailablePalettes(): DyePalette[] {
    return Object.values(DYE_PALETTES);
  }

  /**
   * Applies dye consumable to an avatar slot with transactional validation
   */
  static async applyDye(
    userId: string,
    slot: DyeSlot,
    hexColor: string,
    dyeCost: number = 50
  ) {
    const validSlots: DyeSlot[] = ['topColor', 'bottomColor', 'hairColor', 'eyeColor'];
    if (!validSlots.includes(slot)) {
      throw new Error(`Invalid avatar dye slot: "${slot}". Allowed slots: ${validSlots.join(', ')}.`);
    }

    const cleanHex = hexColor.trim().toUpperCase();
    if (!this.validateHexColor(cleanHex)) {
      throw new Error(`Invalid dye color code: "${hexColor}". Expected format #RRGGBB.`);
    }

    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { avatar: true },
      });

      if (!user) throw new Error('User not found');
      if (user.havenCoins < dyeCost) {
        throw new Error(`Insufficient HavenCoins (required: ${dyeCost}, available: ${user.havenCoins})`);
      }

      // Deduct fee if applicable
      if (dyeCost > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { havenCoins: { decrement: dyeCost } },
        });

        await tx.transactionLog.create({
          data: {
            senderId: userId,
            receiverId: userId,
            amount: dyeCost,
            type: 'DYE_PURCHASE',
            source: `slot:${slot}:${cleanHex}`,
          },
        });
      }

      // Update avatar slot
      const updatedAvatar = await tx.avatar.upsert({
        where: { userId },
        update: { [slot]: cleanHex },
        create: {
          userId,
          [slot]: cleanHex,
        },
      });

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.AVATAR_UPDATE, {
          userId,
          slot,
          color: cleanHex,
          avatar: updatedAvatar,
        });
      }

      return {
        success: true,
        slot,
        color: cleanHex,
        remainingCoins: user.havenCoins - dyeCost,
        avatar: updatedAvatar,
      };
    });
  }
}
