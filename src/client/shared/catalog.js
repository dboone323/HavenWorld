/**
 * HavenWorld — Shared Catalog (Client ESM)
 */

export const CATALOG_ITEMS = {
  'sofa': {
    id: 'sofa', name: 'Cozy Velvet Sofa', price: 500, currency: 'coins',
    category: 'furniture', rarity: 'common', icon: '🛋️',
    w: 2, h: 1, isRotatable: true,
    salvage: { scrap_metal: 4, timber: 8 },
    description: 'A soft velvet sofa that snaps avatars into sitting posture.',
  },
  'table': {
    id: 'table', name: 'Oak Coffee Table', price: 300, currency: 'coins',
    category: 'furniture', rarity: 'common', icon: '🪵',
    w: 2, h: 1, isRotatable: true, surfaceHeight: 12, canStackOn: true,
    salvage: { scrap_metal: 2, timber: 10 },
    description: 'Polished oak table supporting surface item stacking.',
  },
  'plant': {
    id: 'plant', name: 'Monstera Plant', price: 150, currency: 'coins',
    category: 'furniture', rarity: 'common', icon: '🪴',
    w: 1, h: 1, isRotatable: false,
    salvage: { scrap_metal: 1, timber: 4 },
    description: 'Lush green monstera that rustles and emits leaves when clicked.',
  },
  'tv': {
    id: 'tv', name: 'Retro CRT TV', price: 400, currency: 'coins',
    category: 'furniture', rarity: 'uncommon', icon: '📺',
    w: 1, h: 1, isRotatable: true,
    salvage: { scrap_metal: 8, timber: 2 },
    description: 'Retro CRT monitor with interactive channel toggle.',
  },
  'neon': {
    id: 'neon', name: 'Neon Wall Sign', price: 600, currency: 'coins',
    category: 'furniture', rarity: 'rare', icon: '✨',
    w: 1, h: 1, isRotatable: true,
    salvage: { scrap_metal: 12, timber: 1 },
    description: 'Vibrant neon fixture emitting customizable ambient glow.',
  },
  'arcade': {
    id: 'arcade', name: 'Arcade Cabinet', price: 800, currency: 'coins',
    category: 'furniture', rarity: 'rare', icon: '🕹️',
    w: 1, h: 1, isRotatable: true,
    salvage: { scrap_metal: 16, timber: 6 },
    description: 'Interactive cabinet that plays procedural retro chiptunes.',
  },
  'bed': {
    id: 'bed', name: 'Cozy Bed', price: 750, currency: 'coins',
    category: 'furniture', rarity: 'uncommon', icon: '🛏️',
    w: 2, h: 2, isRotatable: true,
    salvage: { scrap_metal: 6, timber: 18 },
    description: 'Restful master bed allowing avatars to lie down and sleep.',
  },
  'bookshelf': {
    id: 'bookshelf', name: 'Wooden Bookshelf', price: 450, currency: 'coins',
    category: 'furniture', rarity: 'common', icon: '📚',
    w: 2, h: 1, isRotatable: true, surfaceHeight: 18, canStackOn: true,
    salvage: { scrap_metal: 3, timber: 12 },
    description: 'Tall library shelf for books and trinkets.',
  },
  'whiteboard': {
    id: 'whiteboard', name: 'Collaborative Whiteboard', price: 650, currency: 'coins',
    category: 'furniture', rarity: 'uncommon', icon: '📋',
    w: 2, h: 1, isRotatable: true,
    salvage: { scrap_metal: 10, timber: 8 },
    description: 'Interactive board for real-time multiplayer drawing.',
  },
  'teleporter_pad': {
    id: 'teleporter_pad', name: 'Quantum Telepad', price: 1200, currency: 'coins',
    category: 'furniture', rarity: 'epic', icon: '🌀',
    w: 1, h: 1, isRotatable: false,
    salvage: { scrap_metal: 25, timber: 5 },
    description: 'Warp pad that transports stepping avatars directly to the Central Plaza.',
  },
  'pet_cat': {
    id: 'pet_cat', name: 'Calico Cat', price: 1000, currency: 'coins',
    category: 'pet', rarity: 'rare', icon: '🐱',
    w: 1, h: 1, isRotatable: true,
    description: 'Curious feline companion that wanders lofts and naps on rugs.',
  },
  'pet_dog': {
    id: 'pet_dog', name: 'Golden Pup', price: 1000, currency: 'coins',
    category: 'pet', rarity: 'rare', icon: '🐶',
    w: 1, h: 1, isRotatable: true,
    description: 'Loyal canine friend that follows the owner and barks joyfully.',
  },
  'pet_dragon': {
    id: 'pet_dragon', name: 'Baby Dragon', price: 50, currency: 'gems',
    category: 'pet', rarity: 'legendary', icon: '🐉',
    w: 1, h: 1, isRotatable: true,
    description: 'Mythical pocket dragon that puffs embers and hovers gently.',
  },
  'hair_pink': {
    id: 'hair_pink', name: 'Pink Hair Dye', price: 200, currency: 'coins',
    category: 'clothing', rarity: 'common', icon: '💗',
  },
  'hair_blue': {
    id: 'hair_blue', name: 'Blue Hair Dye', price: 200, currency: 'coins',
    category: 'clothing', rarity: 'common', icon: '💙',
  },
  'shirt_purple': {
    id: 'shirt_purple', name: 'Purple Hoodie', price: 350, currency: 'coins',
    category: 'clothing', rarity: 'common', icon: '💜',
  },
  'pants_black': {
    id: 'pants_black', name: 'Black Pants', price: 250, currency: 'coins',
    category: 'clothing', rarity: 'common', icon: '🖤',
  },
  'shoes_sneakers': {
    id: 'shoes_sneakers', name: 'Sneakers', price: 300, currency: 'coins',
    category: 'clothing', rarity: 'common', icon: '👟',
  },
  'crown_gold': {
    id: 'crown_gold', name: 'Royal Golden Crown', price: 30, currency: 'gems',
    category: 'clothing', rarity: 'legendary', icon: '👑',
  },
};

export const ROTATING_FEATURED_ITEMS = [
  {
    id: 'celestial_bed', name: 'Celestial Starlight Bed', price: 1800, currency: 'coins',
    category: 'furniture', rarity: 'epic', icon: '🌌', w: 2, h: 2, isRotatable: true,
    salvage: { scrap_metal: 20, timber: 35 },
    description: 'Handcrafted bed infused with stardust particles.',
  },
  {
    id: 'cyber_hologram_tv', name: 'Cyber Hologram Projector', price: 40, currency: 'gems',
    category: 'furniture', rarity: 'legendary', icon: '🔮', w: 1, h: 1, isRotatable: true,
    salvage: { scrap_metal: 35, timber: 10 },
    description: 'Floating volumetric 3D hologram display with neon pulses.',
  },
  {
    id: 'crystal_bonsai', name: 'Glowing Crystal Bonsai', price: 950, currency: 'coins',
    category: 'furniture', rarity: 'rare', icon: '💎', w: 1, h: 1, isRotatable: false,
    salvage: { scrap_metal: 15, timber: 15 },
    description: 'Bonsai tree with radiant amethyst crystal leaves.',
  },
  {
    id: 'vintage_record_player', name: 'Brass Gramophone', price: 850, currency: 'coins',
    category: 'furniture', rarity: 'rare', icon: '🎺', w: 1, h: 1, isRotatable: true,
    salvage: { scrap_metal: 18, timber: 12 },
    description: 'Plays soothing vinyl crackle and vintage cafe melodies.',
  },
  {
    id: 'aurora_trenchcoat', name: 'Aurora Luminescent Coat', price: 25, currency: 'gems',
    category: 'clothing', rarity: 'epic', icon: '🧥',
    description: 'Woven with northern light threads that shift hues dynamically.',
  },
  {
    id: 'phoenix_wings', name: 'Phoenix Fire Wings', price: 60, currency: 'gems',
    category: 'clothing', rarity: 'legendary', icon: '🪽',
    description: 'Flames of rebirth that emit rising heat shimmer particles.',
  },
];

export const ROTATION_PERIOD_MS = 48 * 60 * 60 * 1000;

export function getRotationWindow(timestampMs = Date.now()) {
  return Math.floor(timestampMs / ROTATION_PERIOD_MS);
}

export function getTimeUntilNextRotation(timestampMs = Date.now()) {
  const currentWindow = getRotationWindow(timestampMs);
  const nextWindowTime = (currentWindow + 1) * ROTATION_PERIOD_MS;
  return Math.max(0, nextWindowTime - timestampMs);
}

export function getRotatingFeaturedStock(timestampMs = Date.now()) {
  const windowIdx = getRotationWindow(timestampMs);
  const pool = ROTATING_FEATURED_ITEMS;
  const count = 3;
  const selected = [];
  for (let i = 0; i < count; i++) {
    const pseudoHash = Math.abs((windowIdx * 9301 + i * 49297 + 233280) % pool.length);
    selected.push(pool[pseudoHash]);
  }
  return selected;
}
