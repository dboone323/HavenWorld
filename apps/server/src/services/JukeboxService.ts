import { getIO } from '../sockets';

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

export interface RoomJukeboxState {
  trackId: string;
  startedAt: number;
  durationSeconds: number;
}

export class JukeboxService {
  private static roomTracks = new Map<string, RoomJukeboxState>();

  /**
   * Sets playing chiptune track in room, synchronized across all occupants
   */
  static playTrack(roomId: string, trackId: string): RoomJukeboxState {
    const track = JUKEBOX_CATALOG.find((t) => t.id === trackId);
    if (!track) {
      throw new Error(`Track '${trackId}' not found in Jukebox catalog`);
    }

    const state: RoomJukeboxState = {
      trackId: track.id,
      startedAt: Date.now(),
      durationSeconds: track.durationSeconds,
    };

    this.roomTracks.set(roomId, state);

    const io = getIO();
    if (io) {
      io.to(roomId).emit('jukebox:track_changed', {
        roomId,
        trackId: track.id,
        title: track.title,
        startedAt: state.startedAt,
      });
    }

    return state;
  }

  /**
   * Returns current playing track and calculated playback offset seconds
   */
  static getCurrentTrack(roomId: string): { track: JukeboxTrack | null; offsetSeconds: number } {
    const state = this.roomTracks.get(roomId);
    if (!state) return { track: null, offsetSeconds: 0 };

    const track = JUKEBOX_CATALOG.find((t) => t.id === state.trackId);
    if (!track) return { track: null, offsetSeconds: 0 };

    const elapsedSeconds = (Date.now() - state.startedAt) / 1000;
    const loopedOffset = elapsedSeconds % track.durationSeconds;

    return {
      track,
      offsetSeconds: Math.floor(loopedOffset),
    };
  }
}
