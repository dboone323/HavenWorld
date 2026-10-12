import { getIO } from '../sockets';
import { SOCKET_EVENTS, JUKEBOX_CATALOG } from '@havenworld/shared';
import type { JukeboxTrack } from '@havenworld/shared';

export type { JukeboxTrack } from '@havenworld/shared';
export { JUKEBOX_CATALOG };

export interface RoomJukeboxState {
  trackId: string;
  startedAt: number;
  durationSeconds: number;
}

export interface RoomPlaylist {
  roomId: string;
  tracks: string[];
  currentIndex: number;
  mode: 'LOOP' | 'SHUFFLE';
}

/**
 * Service managing ambient and room chiptune jukebox audio:
 * - Room synchronized playback
 * - Custom playlists (loop / shuffle)
 * - Track skipping throttle (anti-spam)
 * - Live room broadcast notifications
 */
export class JukeboxService {
  private static roomTracks = new Map<string, RoomJukeboxState>();
  private static roomPlaylists = new Map<string, RoomPlaylist>();
  private static lastSkipTimestamps = new Map<string, number>();
  private static readonly SKIP_THROTTLE_MS = 5000;

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
      io.to(roomId).emit(SOCKET_EVENTS.JUKEBOX_TRACK_CHANGED, {
        roomId,
        trackId: track.id,
        title: track.title,
        startedAt: state.startedAt,
      });
    }

    return state;
  }

  /**
   * Configures a custom room playlist.
   */
  static setRoomPlaylist(
    roomId: string,
    trackIds: string[],
    mode: 'LOOP' | 'SHUFFLE' = 'LOOP'
  ): { playlist: string[]; mode: 'LOOP' | 'SHUFFLE'; currentTrack: JukeboxTrack } {
    if (!trackIds.length) {
      throw new Error('Playlist cannot be empty');
    }

    for (const tid of trackIds) {
      if (!JUKEBOX_CATALOG.some((t) => t.id === tid)) {
        throw new Error(`Track '${tid}' not found in Jukebox catalog`);
      }
    }

    const playlist: RoomPlaylist = {
      roomId,
      tracks: [...trackIds],
      currentIndex: 0,
      mode,
    };
    this.roomPlaylists.set(roomId, playlist);

    const firstTrackId = playlist.tracks[0];
    this.playTrack(roomId, firstTrackId);

    const track = JUKEBOX_CATALOG.find((t) => t.id === firstTrackId)!;
    return {
      playlist: playlist.tracks,
      mode: playlist.mode,
      currentTrack: track,
    };
  }

  /**
   * Retrieves the current room playlist
   */
  static getRoomPlaylist(roomId: string): RoomPlaylist | null {
    return this.roomPlaylists.get(roomId) || null;
  }

  /**
   * Adds a track to the existing room playlist
   */
  static addTrackToPlaylist(roomId: string, trackId: string): RoomPlaylist {
    const track = JUKEBOX_CATALOG.find((t) => t.id === trackId);
    if (!track) {
      throw new Error(`Track '${trackId}' not found in Jukebox catalog`);
    }

    let pl = this.roomPlaylists.get(roomId);
    if (!pl) {
      pl = { roomId, tracks: [trackId], currentIndex: 0, mode: 'LOOP' };
      this.roomPlaylists.set(roomId, pl);
      this.playTrack(roomId, trackId);
    } else {
      pl.tracks.push(trackId);
    }
    return pl;
  }

  /**
   * Skips to the next track in the playlist with a 5-second throttle
   */
  static skipTrack(
    roomId: string,
    userId: string,
    options: { force?: boolean } = {}
  ): { state: RoomJukeboxState; track: JukeboxTrack } {
    const now = Date.now();
    const throttleKey = `${roomId}:${userId}`;
    const lastSkip = this.lastSkipTimestamps.get(throttleKey) || 0;

    if (!options.force && now - lastSkip < this.SKIP_THROTTLE_MS) {
      const waitSeconds = Math.ceil((this.SKIP_THROTTLE_MS - (now - lastSkip)) / 1000);
      throw new Error(`Track skipping is throttled. Please wait ${waitSeconds}s before skipping again.`);
    }

    const playlist = this.roomPlaylists.get(roomId);
    let nextTrackId: string;

    if (playlist && playlist.tracks.length > 0) {
      if (playlist.mode === 'SHUFFLE' && playlist.tracks.length > 1) {
        let nextIdx = Math.floor(Math.random() * playlist.tracks.length);
        if (nextIdx === playlist.currentIndex) {
          nextIdx = (nextIdx + 1) % playlist.tracks.length;
        }
        playlist.currentIndex = nextIdx;
      } else {
        playlist.currentIndex = (playlist.currentIndex + 1) % playlist.tracks.length;
      }
      nextTrackId = playlist.tracks[playlist.currentIndex];
    } else {
      const currentState = this.roomTracks.get(roomId);
      const currentIdx = JUKEBOX_CATALOG.findIndex((t) => t.id === currentState?.trackId);
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % JUKEBOX_CATALOG.length : 0;
      nextTrackId = JUKEBOX_CATALOG[nextIdx].id;
    }

    this.lastSkipTimestamps.set(throttleKey, now);
    const state = this.playTrack(roomId, nextTrackId);
    const track = JUKEBOX_CATALOG.find((t) => t.id === nextTrackId)!;

    return { state, track };
  }

  /**
   * Resets skip throttle (useful for testing)
   */
  static resetThrottle(roomId?: string, userId?: string): void {
    if (roomId && userId) {
      this.lastSkipTimestamps.delete(`${roomId}:${userId}`);
    } else {
      this.lastSkipTimestamps.clear();
    }
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
