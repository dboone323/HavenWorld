import type { RawMaterial } from './crafting.js';

/**
 * Phase 3 — shared world content registries.
 *
 * These catalogs drive BOTH the server services (JukeboxService,
 * GatheringService) and the client's in-world props (PublicSpaceProps,
 * JukeboxModal) so a track or node can never exist on one side only.
 */

// ── Jukebox ───────────────────────────────────────────────────────────────────

export interface JukeboxTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
}

export const JUKEBOX_CATALOG: JukeboxTrack[] = [
  { id: 'haven_nostalgia', title: 'Haven Nostalgia', artist: 'Chiptune Maestro', durationSeconds: 96 },
  { id: 'cozy_fireplace', title: 'Cozy Hearthside', artist: 'Pixel Symphony', durationSeconds: 120 },
  { id: 'neon_pulse', title: 'Neon Midnight Pulse', artist: 'RetroSynth', durationSeconds: 140 },
  { id: 'starlight_waltz', title: 'Starlight Waltz', artist: 'Haven Harmonic', durationSeconds: 110 },
];

// ── Gathering nodes ───────────────────────────────────────────────────────────

export interface GatheringNode {
  id: string;
  name: string;
  /** Public room the prop spawns in ('town-square' | 'park' | 'cafe'). */
  roomKey: string;
  material: RawMaterial;
  yieldQuantity: number;
  cooldownSeconds: number;
  /** Client-only: ground placement of the clickable prop, in room-space meters. */
  spot: { x: number; z: number };
  /** Client-only: emoji badge floating above the prop. */
  icon: string;
}

export const GATHERING_NODES: Record<string, GatheringNode> = {
  plaza_apple_tree: {
    id: 'plaza_apple_tree',
    name: 'Plaza Orchard Tree',
    roomKey: 'town-square',
    material: 'timber',
    yieldQuantity: 2,
    cooldownSeconds: 30,
    spot: { x: 9, z: -7 },
    icon: '🌳',
  },
  fountain_wishing_well: {
    id: 'fountain_wishing_well',
    name: 'Fountain Wishing Well',
    roomKey: 'town-square',
    material: 'scrap_metal',
    yieldQuantity: 2,
    cooldownSeconds: 30,
    spot: { x: -9, z: 6 },
    icon: '⛲',
  },
  garden_herb_patch: {
    id: 'garden_herb_patch',
    name: 'Garden Herb Patch',
    roomKey: 'park',
    material: 'fabric',
    yieldQuantity: 2,
    cooldownSeconds: 30,
    spot: { x: 7, z: 7 },
    icon: '🌿',
  },
  crystal_fissure: {
    id: 'crystal_fissure',
    name: 'Subterranean Crystal Fissure',
    roomKey: 'cafe',
    material: 'crystal_shard',
    yieldQuantity: 1,
    cooldownSeconds: 45,
    spot: { x: -7, z: -6 },
    icon: '💎',
  },
};

// ── NPCs wandering public spaces ──────────────────────────────────────────────

export interface NpcPlacement {
  id: string;
  name: string;
  title: string;
  roomKey: string;
  spot: { x: number; z: number };
  /** CSS/hex tint for the billboard body. */
  color: string;
}

export const NPC_PLACEMENTS: NpcPlacement[] = [
  { id: 'mayor_baxter', name: 'Mayor Baxter', title: 'Town Mayor', roomKey: 'town-square', spot: { x: 0, z: -8 }, color: '#c0392b' },
  { id: 'chef_luigi', name: 'Chef Luigi', title: 'Cafe Owner', roomKey: 'cafe', spot: { x: 5, z: -5 }, color: '#e67e22' },
  { id: 'fisherman_pete', name: 'Fisherman Pete', title: 'Dock Regular', roomKey: 'park', spot: { x: -6, z: 8 }, color: '#2980b9' },
];

/** Arcade cabinet + corkboard + jukebox prop placement per public room. */
export const PUBLIC_PROPS: Record<string, Array<{ kind: 'arcade' | 'bulletin' | 'jukebox'; spot: { x: number; z: number } }>> = {
  'room-town-square': [
    { kind: 'arcade', spot: { x: -6, z: -8 } },
    { kind: 'bulletin', spot: { x: 6, z: -9 } },
    { kind: 'jukebox', spot: { x: 10, z: 2 } },
  ],
  'room-cafe': [
    { kind: 'jukebox', spot: { x: 8, z: -4 } },
  ],
  'room-park': [
    { kind: 'bulletin', spot: { x: -8, z: -6 } },
  ],
};

export const ARCADE_CABINET_ID = 'cabinet-town-square-1';
