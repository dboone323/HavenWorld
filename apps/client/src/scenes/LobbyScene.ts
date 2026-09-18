import Phaser from 'phaser';
import type { RoomData } from '@shared/types';
import { authService } from '../services/auth';

/**
 * LobbyScene — displays the #lobby-panel with room cards fetched from the API.
 * Selecting a room starts RoomScene and launches the parallel UIScene.
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
      const SERVER = import.meta.env.VITE_SERVER_URL ?? '';
      const res = await fetch(`${SERVER}/api/rooms`, {
        headers: {
          Authorization: `Bearer ${authService.token ?? ''}`,
        },
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
      grid.innerHTML = `<p class="error-text">Failed to load rooms. <button id="retry-rooms">Retry</button></p>`;
      document.getElementById('retry-rooms')?.addEventListener('click', () => {
        this.fetchRooms().catch(console.error);
      });
    }
  }

  private buildRoomCard(room: RoomData): HTMLElement {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `
      <div class="room-card__name">${escapeHtml(room.name)}</div>
      <div class="room-card__info">
        <span class="room-card__players">${room.players.length} / ${room.capacity}</span>
        <span class="room-card__map">${escapeHtml(room.map)}</span>
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

    this.scene.start('RoomScene', { roomId: room.id, mapKey: room.map });

    if (!this.scene.isActive('UIScene')) {
      this.scene.launch('UIScene');
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
