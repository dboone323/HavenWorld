import { createDefaultPassport } from './passport.js';

export const TITLES = {
  chef: { label: 'Chef', badge: 'pizza_artisan' },
  traveler: { label: 'The Traveler', badge: 'world_traveler' },
  architect: { label: 'Master Architect', badge: 'sanctuary_builder' }
};
export const AURAS = {
  none: { label: 'None', badge: '', color: '#ffffff' },
  halo: { label: 'Resident Halo', badge: 'world_traveler', color: '#a78bfa' },
  sparkles: { label: 'Artisan Sparkles', badge: 'pizza_artisan', color: '#fbbf24' },
  crown: { label: 'Builder Crown', badge: 'sanctuary_builder', color: '#38bdf8' }
};
export const AVATAR_OPTIONS = {
  hairStyle: ['cozy_messy', 'short', 'long', 'bald'],
  hat: ['none', 'beanie'], shirtStyle: ['shirt', 'hoodie', 'trench', 'dress'],
  pantsStyle: ['pants', 'shorts'], shoesStyle: ['sneakers', 'boots'],
  accessory: ['none', 'glasses'], eyeStyle: ['round', 'sleepy'],
  aura: Object.keys(AURAS)
};
export const DEFAULT_AVATAR = {
  skin: '#f5cba7', hairColor: '#4a235a', shirtColor: '#2e86c1',
  pantsColor: '#34495e', shoesColor: '#eeeeee', eyeColor: '#1e293b',
  hairStyle: 'cozy_messy', hat: 'none', shirtStyle: 'shirt',
  pantsStyle: 'pants', shoesStyle: 'sneakers', accessory: 'none', eyeStyle: 'round', aura: 'none'
};
export const COLOR_KEYS = ['skin', 'hairColor', 'shirtColor', 'pantsColor', 'shoesColor', 'eyeColor'];

/** Allowlist only; never copy arbitrary properties from network input. */
export function normalizeAvatar(input, base = DEFAULT_AVATAR) {
  const avatar = { ...DEFAULT_AVATAR, ...base };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return avatar;
  for (const key of COLOR_KEYS) {
    if (typeof input[key] === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(input[key])) avatar[key] = input[key];
  }
  for (const [key, options] of Object.entries(AVATAR_OPTIONS)) {
    if (options.includes(input[key])) avatar[key] = input[key];
  }
  return avatar;
}

export function createIdentity(id = 'guest', name = 'Traveler') {
  return { title: '', statusMessage: '', pinnedBadges: [], presets: [null, null, null],
    outfit: null, passport: createDefaultPassport(id, name) };
}

export function canEquip(catalog, key, passport) {
  if (!key || key === 'none') return true;
  return Object.hasOwn(catalog, key) && !!passport?.unlockedStamps?.[catalog[key].badge];
}

export function formatResidency(registeredAt, now = Date.now()) {
  const date = registeredAt ? new Date(registeredAt) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'Registration date unavailable';
  const month = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const days = Math.max(0, Math.floor((now - date.getTime()) / 86400000));
  return `Resident since: ${month} (${days} days ago)`;
}
