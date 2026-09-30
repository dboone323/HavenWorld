import { socketService } from '../services/socket';
import { SOCKET_EVENTS, JUKEBOX_CATALOG } from '@havenworld/shared';
import type { JukeboxTrack } from '@havenworld/shared';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface RoomJukeboxState {
  roomId: string;
  trackId: string;
  title: string;
  startedAt: number;
}

/**
 * Jukebox furniture panel (roadmap §3l).
 * Lists the shared catalog; emits JUKEBOX_PLAY and listens for the room-wide
 * JUKEBOX_TRACK_CHANGED broadcast to show a live "now playing" row.
 * NOTE: audio assets for the chiptune catalog are not yet available — this is
 * the interaction shell + sync state; audio playback drops in when assets ship.
 */
export class JukeboxModal {
  private static overlay: HTMLElement | null = null;
  private static unsubs: Array<() => void> = [];
  private static nowPlaying: RoomJukeboxState | null = null;

  static show(roomId: string): void {
    this.dismiss();

    const overlay = document.createElement('div');
    overlay.id = 'jukebox-panel-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1b1b36; border: 1px solid rgba(255,255,255,0.18);
      border-radius: 16px; width: 420px; max-height: 80vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    `;

    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const render = () => this.render(panel, roomId, render);

    this.unsubs.push(
      socketService.on<RoomJukeboxState>(SOCKET_EVENTS.JUKEBOX_TRACK_CHANGED, (state) => {
        this.nowPlaying = state;
        if (this.overlay) render();
      })
    );

    render();
  }

  private static render(panel: HTMLElement, roomId: string, rerender: () => void): void {
    const rows = JUKEBOX_CATALOG.map((track: JukeboxTrack) => {
      const playing = this.nowPlaying?.trackId === track.id;
      return `
        <div data-track="${escapeHtml(track.id)}" role="button" tabindex="0" style="
          display:flex; align-items:center; gap:12px; padding:10px 12px; margin-bottom:8px;
          border-radius:10px; cursor:pointer; user-select:none;
          background:${playing ? 'rgba(78,205,196,0.18)' : 'rgba(255,255,255,0.06)'};
          border:1px solid ${playing ? 'rgba(78,205,196,0.7)' : 'rgba(255,255,255,0.1)'};
        ">
          <span style="font-size:20px">${playing ? '🎶' : '🎵'}</span>
          <span style="flex:1">
            <strong>${escapeHtml(track.title)}</strong>
            <span style="display:block;font-size:12px;opacity:0.7">${escapeHtml(track.artist)} · ${Math.floor(track.durationSeconds / 60)}:${String(track.durationSeconds % 60).padStart(2, '0')}</span>
          </span>
          ${playing ? '<span style="font-size:11px;color:#4ecdc4">NOW PLAYING</span>' : '<span style="opacity:0.6">▶</span>'}
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0;font-size:18px">🎹 Room Jukebox</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      ${rows}
      <p style="font-size:12px;opacity:0.6;margin:12px 0 0">Track changes broadcast to everyone in the room.</p>
    `;

    panel.querySelectorAll<HTMLElement>('[data-track]').forEach((el) => {
      const play = () => {
        const trackId = el.dataset.track as string;
        socketService.emit(SOCKET_EVENTS.JUKEBOX_PLAY, { roomId, trackId });
        const track = JUKEBOX_CATALOG.find((t) => t.id === trackId);
        showToast({ icon: '🎹', title: 'Selecting track…', subtitle: track?.title ?? trackId });
        rerender();
      };
      el.addEventListener('click', play);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
    });
    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
  }

  static dismiss(): void {
    this.unsubs.forEach((off) => off());
    this.unsubs = [];
    this.overlay?.remove();
    this.overlay = null;
  }
}
