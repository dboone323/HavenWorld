import Phaser from 'phaser';
import { authService } from '../services/auth';
import type { RoomData } from '@shared/types';

/**
 * LobbyScene — displays room browser HTML overlay.
 * Fetches rooms via REST API and transitions to RoomScene on selection.
 */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    document.getElementById('login-panel')?.classList.add('hidden');
    document.getElementById('game-container')?.classList.add('hidden');
    document.getElementById('lobby-panel')?.classList.remove('hidden');

    this.fetchRooms().catch(console.error);
  }

  private async fetchRooms(): Promise<void> {
    const grid = document.getElementById('room-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="loading-text">Loading rooms…</p>';

    try {
      const SERVER = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://147-224-164-228.nip.io' : '');
      const token = authService.token || authService.getToken() || '';
      const res = await fetch(`${SERVER}/api/rooms`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const rooms: RoomData[] = await res.json();
      grid.innerHTML = '';

      if (rooms.length === 0) {
        grid.innerHTML = '<p class="loading-text">No rooms available.</p>';
        return;
      }

      for (const room of rooms) {
        const card = this.buildRoomCard(room);
        grid.appendChild(card);
      }
    } catch (err) {
      console.error('[LobbyScene] Error fetching rooms:', err);
      grid.innerHTML = `<p class="error-text">Failed to load rooms. <button id="retry-rooms">Retry</button></p>`;
      document.getElementById('retry-rooms')?.addEventListener('click', () => {
        this.fetchRooms().catch(console.error);
      });
    }
  }

  private buildRoomCard(room: RoomData): HTMLElement {
    const card = document.createElement('div');
    card.className = 'room-card';

    const occupants = room.occupants ?? room.players?.length ?? 0;
    const capacity = room.maxOccupants ?? room.capacity ?? 50;
    const mapDisplay = room.theme || room.map || 'Public';

    card.innerHTML = `
      <div class="room-card__name">${escapeHtml(room.name)}</div>
      <div class="room-card__info">
        <span class="room-card__players">${occupants} / ${capacity}</span>
        <span class="room-card__map">${escapeHtml(mapDisplay)}</span>
      </div>
      <button class="btn btn--teal room-card__join">Join</button>
    `;

    card.querySelector('.room-card__join')?.addEventListener('click', () => {
      this.enterRoom(room);
    });

    return card;
  }

  private enterRoom(room: RoomData): void {
    document.getElementById('lobby-panel')?.classList.add('hidden');
    document.getElementById('game-container')?.classList.remove('hidden');

    const mapKey = room.id.replace('room-', '');
    this.scene.start('RoomScene', { roomId: room.id, mapKey });

    if (!this.scene.isActive('UIScene')) {
      this.scene.launch('UIScene');
    }
  }
}

function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
