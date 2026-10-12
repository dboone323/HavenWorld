import { WeatherService } from '../../services/WeatherService';
import { JukeboxService } from '../../services/JukeboxService';
import { RandomizerService } from '../../services/RandomizerService';
import { ArcadeService } from '../../services/ArcadeService';
import { NpcDialogueService } from '../../services/NpcDialogueService';
import { GlobalEventService } from '../../services/GlobalEventService';
import { DelayedMailService } from '../../services/DelayedMailService';
import { EmoteProgressionService } from '../../services/EmoteProgressionService';

// Unit-scope notes: getIO() returns null in these tests (no server attached),
// which the services guard with `if (io)` — broadcasts are silently skipped.
// DB-touching paths are limited to error paths that need no seeded rows.

describe('Phase 3B WeatherService', () => {
  it('clamps intensity into the 0..1 range', () => {
    expect(WeatherService.setWeather('RAIN', 5).intensity).toBe(1);
    expect(WeatherService.setWeather('SNOW', -2).intensity).toBe(0);
    expect(WeatherService.setWeather('AURORA', 0.42).intensity).toBeCloseTo(0.42);
  });

  it('getWeather reflects the last set condition', () => {
    WeatherService.setWeather('RAIN', 0.8);
    const state = WeatherService.getWeather();
    expect(state.currentWeather).toBe('RAIN');
    expect(state.changedAt).toBeLessThanOrEqual(Date.now());
  });

  it('computes atmospheric visual and audio overlay parameters for every weather condition', () => {
    WeatherService.setWeather('RAIN', 0.8);
    let state = WeatherService.getWeather();
    expect(state.overlay).toBeDefined();
    expect(state.overlay?.ambientColor).toBe('#4a5568');
    expect(state.overlay?.particleCount).toBe(400);
    expect(state.overlay?.soundEffect).toBe('ambient_rain');

    WeatherService.setWeather('SUNNY', 0.5);
    state = WeatherService.getWeather();
    expect(state.overlay?.particleCount).toBe(0);
    expect(state.overlay?.soundEffect).toBeNull();

    WeatherService.setWeather('AURORA', 0.5);
    state = WeatherService.getWeather();
    expect(state.overlay?.tint).toBe('#06b6d4');
    expect(state.overlay?.soundEffect).toBe('ambient_shimmer');

    WeatherService.setWeather('SNOW', 1.0);
    state = WeatherService.getWeather();
    expect(state.overlay?.particleCount).toBe(300);
    expect(state.overlay?.soundEffect).toBe('ambient_wind');
  });

  it('governs valid transitions in the weather state machine', () => {
    const sunnyTransitions = WeatherService.getNextPossibleWeather('SUNNY');
    expect(sunnyTransitions).toContain('RAIN');
    expect(sunnyTransitions).toContain('AURORA');

    const auroraTransitions = WeatherService.getNextPossibleWeather('AURORA');
    expect(auroraTransitions).toContain('SUNNY');
    expect(auroraTransitions).not.toContain('SNOW');

    const nextState = WeatherService.transitionWeather();
    expect(['SUNNY', 'RAIN', 'AURORA', 'SNOW']).toContain(nextState.currentWeather);
    expect(nextState.intensity).toBeGreaterThanOrEqual(0.3);
  });
});

describe('Phase 3B JukeboxService', () => {
  it('plays a catalog track and exposes it as the room state', () => {
    const state = JukeboxService.playTrack('room-juke-1', 'neon_pulse');
    expect(state.trackId).toBe('neon_pulse');
    expect(state.durationSeconds).toBeGreaterThan(0);
    const current = JukeboxService.getCurrentTrack('room-juke-1');
    expect(current.track?.id).toBe('neon_pulse');
  });

  it('rejects tracks outside the catalog', () => {
    expect(() => JukeboxService.playTrack('room-juke-1', 'not_a_real_track')).toThrow(/not found/i);
  });

  it('reports no track for a room that never played one', () => {
    expect(JukeboxService.getCurrentTrack('room-never-played').track).toBeNull();
  });

  describe('Batch 25: Custom Playlist Management & Skip Throttle', () => {
    beforeEach(() => {
      JukeboxService.resetThrottle();
    });

    it('setRoomPlaylist initializes custom playlist, validates tracks, and plays first track', () => {
      const result = JukeboxService.setRoomPlaylist('room-party', ['haven_nostalgia', 'cozy_fireplace', 'neon_pulse'], 'LOOP');
      expect(result.playlist).toEqual(['haven_nostalgia', 'cozy_fireplace', 'neon_pulse']);
      expect(result.mode).toBe('LOOP');
      expect(result.currentTrack.id).toBe('haven_nostalgia');

      const pl = JukeboxService.getRoomPlaylist('room-party');
      expect(pl?.tracks).toHaveLength(3);
      expect(pl?.currentIndex).toBe(0);

      // Current room track matches
      const current = JukeboxService.getCurrentTrack('room-party');
      expect(current.track?.id).toBe('haven_nostalgia');

      // Reject empty or invalid track playlist
      expect(() => JukeboxService.setRoomPlaylist('room-party', [])).toThrow(/empty/i);
      expect(() => JukeboxService.setRoomPlaylist('room-party', ['fake_audio_track'])).toThrow(/not found/i);
    });

    it('addTrackToPlaylist appends tracks to an existing playlist', () => {
      JukeboxService.setRoomPlaylist('room-party-2', ['haven_nostalgia']);
      const updated = JukeboxService.addTrackToPlaylist('room-party-2', 'cozy_fireplace');
      expect(updated.tracks).toEqual(['haven_nostalgia', 'cozy_fireplace']);
    });

    it('skipTrack advances through playlist and throttles rapid skips within 5 seconds', () => {
      JukeboxService.setRoomPlaylist('room-disco', ['haven_nostalgia', 'cozy_fireplace', 'neon_pulse'], 'LOOP');

      // First skip succeeds
      const skip1 = JukeboxService.skipTrack('room-disco', 'dj_user');
      expect(skip1.track.id).toBe('cozy_fireplace');

      // Immediate second skip by same user triggers throttle
      expect(() => JukeboxService.skipTrack('room-disco', 'dj_user')).toThrow(/throttled/i);

      // Force option bypasses throttle
      const forcedSkip = JukeboxService.skipTrack('room-disco', 'dj_user', { force: true });
      expect(forcedSkip.track.id).toBe('neon_pulse');

      // Next skip loops back to beginning
      const loopedSkip = JukeboxService.skipTrack('room-disco', 'dj_user', { force: true });
      expect(loopedSkip.track.id).toBe('haven_nostalgia');
    });

    it('supports SHUFFLE mode when skipping tracks', () => {
      JukeboxService.setRoomPlaylist('room-shuffle', ['haven_nostalgia', 'cozy_fireplace', 'neon_pulse'], 'SHUFFLE');
      const skipped = JukeboxService.skipTrack('room-shuffle', 'dj_user', { force: true });
      expect(['haven_nostalgia', 'cozy_fireplace', 'neon_pulse']).toContain(skipped.track.id);
    });
  });
});

describe('Phase 3B RandomizerService', () => {
  it('rolls inside [1, sides] for a valid die (unknown user falls back to "Player")', async () => {
    const roll = await RandomizerService.rollDice('user-does-not-exist', 'room-rng-1', 6);
    expect(roll.result).toBeGreaterThanOrEqual(1);
    expect(roll.result).toBeLessThanOrEqual(6);
    expect(roll.username).toBe('Player');
    expect(roll.formattedMessage).toContain('🎲');
  });

  it('rejects invalid die sizes before rolling', async () => {
    await expect(RandomizerService.rollDice('u1', 'r1', 1)).rejects.toThrow(/between 2 and 100/);
    await expect(RandomizerService.rollDice('u1', 'r1', 101)).rejects.toThrow(/between 2 and 100/);
  });
});

describe('Phase 3B ArcadeService (Connect-4)', () => {
  it('refers to start a match against yourself', () => {
    expect(() => ArcadeService.startMatch('p1', 'p1', 'cab-1')).toThrow(/yourself/i);
  });

  it('enforces turn order and column bounds', () => {
    const match = ArcadeService.startMatch('alice', 'bob', 'cab-2');
    expect(match.currentTurn).toBe('alice');
    expect(() => ArcadeService.makeMove(match.id, 'bob', 3)).toThrow(/not your turn/i);
    expect(() => ArcadeService.makeMove(match.id, 'alice', 7)).toThrow(/invalid column/i);
  });

  it('detects a horizontal four-in-a-row and locks the match', () => {
    const match = ArcadeService.startMatch('carol', 'dave', 'cab-3');
    const seq: Array<[string, number]> = [
      ['carol', 0], ['dave', 4],
      ['carol', 1], ['dave', 5],
      ['carol', 2], ['dave', 6],
      ['carol', 3], // completes bottom row 0..3 for carol
    ];
    let last = match;
    for (const [player, col] of seq) last = ArcadeService.makeMove(match.id, player, col);
    expect(last.status).toBe('FINISHED');
    expect(last.winnerId).toBe('carol');
    expect(() => ArcadeService.makeMove(match.id, 'dave', 4)).toThrow(/already finished/i);
  });

  it('fills columns from the bottom and rejects full columns', () => {
    const match = ArcadeService.startMatch('erin', 'fred', 'cab-4');
    const players: [string, string] = ['erin', 'fred'];
    for (let i = 0; i < 6; i++) {
      ArcadeService.makeMove(match.id, players[i % 2], 0);
    }
    // column 0 now holds 3 erin + 3 fred discs (stacked), Erin to move again
    expect(() => ArcadeService.makeMove(match.id, 'erin', 0)).toThrow(/full/i);
  });
});

describe('Phase 3B NpcDialogueService', () => {
  it('serves the start node for a known NPC', () => {
    const node = NpcDialogueService.getDialogue('mayor_baxter');
    expect(node.id).toBe('start');
    expect(node.npcId).toBe('mayor_baxter');
    expect(Array.isArray(node.choices)).toBe(true);
  });

  it('throws for unknown NPCs, nodes, and choice indexes', () => {
    expect(() => NpcDialogueService.getDialogue('npc_ghost')).toThrow(/does not have dialogue/i);
    expect(() => NpcDialogueService.getDialogue('mayor_baxter', 'nope_node')).toThrow(/not found/i);
    expect(() => NpcDialogueService.selectOption('chef_luigi', 'start', 99)).toThrow(/invalid choice/i);
  });
});

describe('Phase 3B GlobalEventService', () => {
  it('activates a world event with its multiplier and surfaces it as active', () => {
    const event = GlobalEventService.triggerGlobalEvent('DOUBLE_COINS', 'Double Coin Weekend', '2x coins everywhere', 30, 2);
    expect(event.isActive).toBe(true);
    expect(event.multiplier).toBe(2);
    expect(GlobalEventService.getActiveEvent()?.title).toBe('Double Coin Weekend');
  });
});

describe('Phase 3B DelayedMailService', () => {
  it('rejects self-parcels and unowned items, and schedules a parcel when sender owns the item', async () => {
    const { prisma } = await import('../../prisma');
    await expect(
      DelayedMailService.sendDelayedParcel('same-user', 'same-user', 'item_rose', 'hi', 60)
    ).rejects.toThrow(/yourself/i);

    await expect(
      DelayedMailService.sendDelayedParcel('nonexistent-sender', 'recipient-1', 'item_rose', 'hi', 60)
    ).rejects.toThrow(/do not own/i);

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sender = await prisma.user.create({
      data: {
        username: `mail_s_${suffix}`.slice(0, 20),
        email: `mail_s_${suffix}@haven.test`,
        passwordHash: 'hash',
      },
    });
    const recipient = await prisma.user.create({
      data: {
        username: `mail_r_${suffix}`.slice(0, 20),
        email: `mail_r_${suffix}@haven.test`,
        passwordHash: 'hash',
      },
    });
    const item = await prisma.item.create({
      data: {
        id: `item_rose_${suffix}`,
        name: 'Rose',
        description: 'A red rose',
        category: 'DECORATION',
        rarity: 'COMMON',
        price: 10,
        spriteKey: 'rose',
        isTradeable: true,
      },
    });
    await prisma.inventory.create({
      data: { userId: sender.id, itemId: item.id, quantity: 1 },
    });

    const before = Date.now();
    const parcel = await DelayedMailService.sendDelayedParcel(sender.id, recipient.id, item.id, '  be safe out there  ', 120);
    expect(parcel.delivered).toBe(false);
    expect(parcel.message).toBe('be safe out there');
    expect(parcel.deliverAt).toBeGreaterThanOrEqual(before + 120 * 60_000);
  });
});

describe('Phase 3B EmoteProgressionService', () => {
  it('rejects unknown players rather than inventing unlocks', async () => {
    await expect(EmoteProgressionService.getPlayerEmotes('user-that-does-not-exist')).rejects.toThrow(/user not found/i);
  });
});
