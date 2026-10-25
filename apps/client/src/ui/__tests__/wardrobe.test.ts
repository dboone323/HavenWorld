import { describe, it, expect } from 'vitest';
import {
  GENDER_PRESETS,
  ITEM_ACCENT_COLORS,
  WARDROBE_TABS,
  applyGenderPreset,
  getItemAccentColor,
  groupWardrobeItems,
  normalizeGender,
  STARTER_WARDROBE_ITEM_IDS,
  EXCLUDED_SLOT_VALUES,
  isStarterWardrobeItem,
  isExcludedSlotValue,
  type WardrobeItem,
} from '@havenworld/shared';
import { MI_PLANET_CATALOG } from '../AvatarCustomizer';

describe('Avatar wardrobe helpers (@havenworld/shared)', () => {
  describe('normalizeGender', () => {
    it('accepts the canonical values, common aliases and casing', () => {
      expect(normalizeGender('male')).toBe('male');
      expect(normalizeGender('MALE')).toBe('male');
      expect(normalizeGender('M')).toBe('male');
      expect(normalizeGender('female')).toBe('female');
      expect(normalizeGender('f')).toBe('female');
    });

    it('falls back to "unspecified" for empty, null and unknown input', () => {
      expect(normalizeGender(undefined)).toBe('unspecified');
      expect(normalizeGender(null)).toBe('unspecified');
      expect(normalizeGender('')).toBe('unspecified');
      expect(normalizeGender('apache-helicopter')).toBe('unspecified');
      expect(normalizeGender(42)).toBe('unspecified');
    });
  });

  describe('applyGenderPreset', () => {
    it('applies the male proportions and a default hair style when none is set', () => {
      const result = applyGenderPreset({ skinTone: '#F5CBA7' }, 'male');

      expect(result.gender).toBe('male');
      expect(result.bodyType).toBe(GENDER_PRESETS.male.bodyType);
      expect(result.height).toBe(GENDER_PRESETS.male.height);
      expect(result.build).toBe(GENDER_PRESETS.male.build);
      expect(result.hairStyle).toBe(GENDER_PRESETS.male.defaultHairStyle);
    });

    it('preserves an explicitly chosen hair style', () => {
      const result = applyGenderPreset({ hairStyle: 'hair-long-01' }, 'female');
      expect(result.hairStyle).toBe('hair-long-01');
      expect(result.gender).toBe('female');
    });

    it('leaves an avatar untouched apart from the gender when unspecified', () => {
      const result = applyGenderPreset({ bodyType: 0.9, hairStyle: 'hair-short-02' }, 'unspecified');
      expect(result.gender).toBe('unspecified');
      expect(result.bodyType).toBe(0.9);
      expect(result.hairStyle).toBe('hair-short-02');
    });
  });

  describe('getItemAccentColor', () => {
    it('returns the explicit colour for a known starter item', () => {
      expect(getItemAccentColor('shirt-white')).toBe(ITEM_ACCENT_COLORS['shirt-white']);
      expect(getItemAccentColor('pants-blue')).toBe(ITEM_ACCENT_COLORS['pants-blue']);
    });

    it('falls back to the colour word inside an unknown item id', () => {
      expect(getItemAccentColor('jacket-teal')).toBe('#4ECDC4');
      expect(getItemAccentColor('shoes-black')).toBe('#1C1C1C');
    });

    it('uses the supplied fallback for null, empty and uncoloured ids', () => {
      expect(getItemAccentColor(null, '#ABCDEF')).toBe('#ABCDEF');
      expect(getItemAccentColor('', '#ABCDEF')).toBe('#ABCDEF');
      expect(getItemAccentColor('mystery-tunic', '#ABCDEF')).toBe('#ABCDEF');
    });
  });

  describe('groupWardrobeItems', () => {
    const inventory: WardrobeItem[] = [
      { itemId: 'hair-short-01', name: 'Short Hair', category: 'HAIR' },
      { itemId: 'shirt-blue', name: 'Blue Shirt', category: 'CLOTHING_BODY' },
      { itemId: 'pants-black', name: 'Black Pants', category: 'CLOTHING_LEGS' },
      { itemId: 'shoes-white', name: 'White Sneakers', category: 'CLOTHING_FEET' },
      { itemId: 'hat-cap-01', name: 'Ball Cap', category: 'CLOTHING_HEAD' },
      { itemId: 'furniture-chair', name: 'Wooden Chair', category: 'FURNITURE' },
    ];

    it('buckets owned clothing into their tabs and ignores non-clothing categories', () => {
      const grouped = groupWardrobeItems(inventory);

      expect(grouped.hair.map((i) => i.itemId)).toEqual(['hair-short-01']);
      expect(grouped.tops.map((i) => i.itemId)).toEqual(['shirt-blue']);
      expect(grouped.bottoms.map((i) => i.itemId)).toEqual(['pants-black']);
      expect(grouped.shoes.map((i) => i.itemId)).toEqual(['shoes-white']);
      expect(grouped.headwear.map((i) => i.itemId)).toEqual(['hat-cap-01']);

      const allBucketed = Object.values(grouped).flat();
      expect(allBucketed.some((i) => i.itemId === 'furniture-chair')).toBe(false);
    });

    it('returns an empty array (not undefined) for every tab when the inventory is empty', () => {
      const grouped = groupWardrobeItems([]);
      for (const tab of WARDROBE_TABS) {
        expect(grouped[tab.id]).toEqual([]);
      }
    });

    it('exposes a tab for every clothing category owned by the starter seed', () => {
      const tabbedCategories = new Set(WARDROBE_TABS.flatMap((tab) => tab.categories));
      for (const category of [
        'HAIR',
        'CLOTHING_HEAD',
        'CLOTHING_FACE',
        'CLOTHING_BODY',
        'CLOTHING_BACK',
        'CLOTHING_LEGS',
        'CLOTHING_FEET',
      ]) {
        expect(tabbedCategories.has(category)).toBe(true);
      }
    });
  });

  describe('Starter wardrobe items & exclusions (@havenworld/shared)', () => {
    it('recognizes starter wardrobe items without inventory rows', () => {
      expect(isStarterWardrobeItem('denim-jeans')).toBe(true);
      expect(isStarterWardrobeItem('pink-llama-sweater')).toBe(true);
      expect(isStarterWardrobeItem('olive-shorts')).toBe(true);
      expect(isStarterWardrobeItem('purple-sneakers')).toBe(true);
      expect(isStarterWardrobeItem('trapper-hat')).toBe(true);
      expect(isStarterWardrobeItem('skull-balaclava')).toBe(true);
      expect(isStarterWardrobeItem('black-wings')).toBe(true);
      expect(isStarterWardrobeItem('white-wings')).toBe(true);
      expect(isStarterWardrobeItem('wavy-hair')).toBe(true);
      expect(isStarterWardrobeItem('shirt-white')).toBe(true);
      expect(isStarterWardrobeItem('pants-blue')).toBe(true);
      expect(isStarterWardrobeItem('shoes-white')).toBe(true);

      expect(isStarterWardrobeItem('legendary-dragon-cape')).toBe(false);
      expect(isStarterWardrobeItem(null)).toBe(false);
      expect(isStarterWardrobeItem(undefined)).toBe(false);
    });

    it('identifies unequipped and empty slot sentinel values', () => {
      expect(isExcludedSlotValue('none')).toBe(true);
      expect(isExcludedSlotValue('underwear')).toBe(true);
      expect(isExcludedSlotValue('barefoot')).toBe(true);
      expect(isExcludedSlotValue('bald')).toBe(true);
      expect(isExcludedSlotValue('')).toBe(true);
      expect(isExcludedSlotValue(null)).toBe(true);
      expect(isExcludedSlotValue(undefined)).toBe(true);

      expect(isExcludedSlotValue('denim-jeans')).toBe(false);
      expect(isExcludedSlotValue('shirt-white')).toBe(false);
    });

    it('correctly maps denim-jeans and starter catalog wearables to distinct accent colours', () => {
      expect(getItemAccentColor('denim-jeans')).toBe('#2C4C8C');
      expect(getItemAccentColor('olive-shorts')).toBe('#556B2F');
      expect(getItemAccentColor('pink-llama-sweater')).toBe('#FFB6C1');
      expect(getItemAccentColor('purple-sneakers')).toBe('#8A2BE2');
      expect(getItemAccentColor('trapper-hat')).toBe('#8B4513');
      expect(getItemAccentColor('skull-balaclava')).toBe('#2F4F4F');
      expect(getItemAccentColor('wavy-hair')).toBe('#D4AF37');
      expect(getItemAccentColor('black-wings')).toBe('#1C1C1C');
      expect(getItemAccentColor('white-wings')).toBe('#F5F5F5');
    });

    it('maps denim-jeans to the correct MiPlanet asset and slot in MI_PLANET_CATALOG', () => {
      const jeans = MI_PLANET_CATALOG.find((it) => it.id === 'denim-jeans');
      expect(jeans).toBeDefined();
      expect(jeans?.slot).toBe('outfitLegs');
      expect(jeans?.category).toBe('bottoms');
      expect(jeans?.asset).toBe('/assets/sprites/avatar/wearables/MiPlanet Denim Jeans.png');

      const shorts = MI_PLANET_CATALOG.find((it) => it.id === 'olive-shorts');
      expect(shorts).toBeDefined();
      expect(shorts?.asset).toBe('/assets/sprites/avatar/wearables/MiPlanet Olive Green Shorts.png');
      expect(jeans?.asset).not.toBe(shorts?.asset);
    });
  });
});