import type { AvatarData } from './types.js';

// ── Gender ────────────────────────────────────────────────────────────────────
export type Gender = 'male' | 'female' | 'unspecified';

export interface GenderPreset {
  label: string;
  /** Morph-target values applied when the player picks this gender. */
  bodyType: number;
  height: number;
  build: number;
  /** Proportion multipliers used by the 3D client to shape shoulders vs. hips. */
  shoulderScale: number;
  hipScale: number;
  defaultHairStyle: string;
}

export const GENDER_PRESETS: Record<Exclude<Gender, 'unspecified'>, GenderPreset> = {
  male: {
    label: 'Male',
    bodyType: 0.45,
    height: 0.58,
    build: 0.68,
    shoulderScale: 1.12,
    hipScale: 0.94,
    defaultHairStyle: 'hair-short-01',
  },
  female: {
    label: 'Female',
    bodyType: 0.5,
    height: 0.5,
    build: 0.42,
    shoulderScale: 0.96,
    hipScale: 1.1,
    defaultHairStyle: 'hair-long-01',
  },
};

/** Coerces arbitrary input (DB value, form value, URL param) into a known Gender. */
export function normalizeGender(value: unknown): Gender {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'male' || v === 'm' || v === 'man') return 'male';
  if (v === 'female' || v === 'f' || v === 'woman') return 'female';
  return 'unspecified';
}

/** Returns the morph/proportion values for a gender, preserving explicit overrides. */
export function applyGenderPreset(avatar: AvatarData, gender: Gender): AvatarData {
  if (gender === 'unspecified') return { ...avatar, gender };
  const preset = GENDER_PRESETS[gender];
  return {
    ...avatar,
    gender,
    bodyType: preset.bodyType,
    height: preset.height,
    build: preset.build,
    hairStyle: avatar.hairStyle || preset.defaultHairStyle,
  };
}

// ── Outfit slots ──────────────────────────────────────────────────────────────
export type OutfitSlot =
  | 'outfitHead'
  | 'outfitFace'
  | 'outfitBody'
  | 'outfitLegs'
  | 'outfitFeet'
  | 'outfitBack'
  | 'outfitHand';

export const OUTFIT_SLOTS: OutfitSlot[] = [
  'outfitHead',
  'outfitFace',
  'outfitBody',
  'outfitLegs',
  'outfitFeet',
  'outfitBack',
  'outfitHand',
];

// ── Item accent colours ───────────────────────────────────────────────────────
const COLOR_WORDS: Record<string, string> = {
  white: '#F5F5F5',
  black: '#1C1C1C',
  blue: '#4169E1',
  navy: '#1E3A8A',
  red: '#B22222',
  green: '#2E8B57',
  grey: '#808080',
  gray: '#808080',
  brown: '#8B4513',
  pink: '#E91E63',
  purple: '#8B008B',
  gold: '#FFD700',
  silver: '#C0C0C0',
  teal: '#4ECDC4',
};

/**
 * Explicit colours for the seeded starter wardrobe. Anything not listed here
 * falls back to the colour word inside the item id (e.g. `shoes-black`), then
 * to the supplied fallback.
 */
export const ITEM_ACCENT_COLORS: Record<string, string> = {
  'shirt-white': '#F5F5F5',
  'shirt-black': '#1C1C1C',
  'shirt-blue': '#4169E1',
  'pants-blue': '#2C4C8C',
  'pants-black': '#1C1C1C',
  'shoes-white': '#F5F5F5',
  'shoes-black': '#1C1C1C',
  'hair-short-01': '#3B2314',
  'hair-short-02': '#1C1C1C',
  'hair-long-01': '#5C3317',
};

/** Resolves the render colour for an equipped item id. Never throws. */
export function getItemAccentColor(itemId: string | null | undefined, fallback = '#B0BEC5'): string {
  if (!itemId) return fallback;
  const explicit = ITEM_ACCENT_COLORS[itemId];
  if (explicit) return explicit;

  for (const word of itemId.toLowerCase().split(/[-_.]/)) {
    const colour = COLOR_WORDS[word];
    if (colour) return colour;
  }

  return fallback;
}

// ── Wardrobe tabs ─────────────────────────────────────────────────────────────
export interface WardrobeTab {
  id: string;
  label: string;
  icon: string;
  /** Prisma `ItemCategory` values that belong in this tab. */
  categories: string[];
  /**
   * Avatar column this tab equips into. `null` means the tab drives
   * `hairStyle` directly (the item id *is* the hair style key).
   */
  slot: OutfitSlot | null;
}

export const WARDROBE_TABS: WardrobeTab[] = [
  { id: 'hair', label: 'Hair', icon: '💇', categories: ['HAIR'], slot: null },
  {
    id: 'tops',
    label: 'Tops',
    icon: '',
    categories: ['CLOTHING_BODY', 'CLOTHING_BACK'],
    slot: 'outfitBody',
  },
  { id: 'bottoms', label: 'Pants', icon: '', categories: ['CLOTHING_LEGS'], slot: 'outfitLegs' },
  { id: 'shoes', label: 'Shoes', icon: '👟', categories: ['CLOTHING_FEET'], slot: 'outfitFeet' },
  {
    id: 'headwear',
    label: 'Headwear',
    icon: '🎩',
    categories: ['CLOTHING_HEAD', 'CLOTHING_FACE'],
    slot: 'outfitHead',
  },
];

/** Inventory row shape returned by `GET /api/users/me/inventory`. */
export interface WardrobeItem {
  itemId: string;
  name: string;
  category?: string;
  spriteKey?: string;
  quantity?: number;
}

/**
 * Groups owned inventory items into the wardrobe tabs. Items whose category is
 * unknown to every tab are omitted rather than silently mixed together.
 */
export function groupWardrobeItems(items: WardrobeItem[]): Record<string, WardrobeItem[]> {
  const grouped: Record<string, WardrobeItem[]> = {};
  for (const tab of WARDROBE_TABS) grouped[tab.id] = [];

  for (const item of items) {
    const category = (item.category ?? '').toUpperCase();
    for (const tab of WARDROBE_TABS) {
      if (tab.categories.includes(category)) {
        grouped[tab.id].push(item);
        break;
      }
    }
  }

  return grouped;
}