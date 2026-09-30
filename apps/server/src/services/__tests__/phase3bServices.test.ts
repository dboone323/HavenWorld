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
  it('schedules a parcel with a future delivery timestamp', async () => {
    const before = Date.now();
    const parcel = await DelayedMailService.sendDelayedParcel('sender-1', 'recipient-1', 'item_rose', '  be safe out there  ', 120);
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
