import Phaser from 'phaser';
import { authService } from '../services/auth';
import type { RoomData } from '@shared/types';

/**
 * LobbyScene — displays room & loft directory overlay.
 * Fetches rooms/lofts via REST API and transitions to RoomScene on selection.
 */
export class LobbyScene extends Phaser.Scene {
  private activeTab: 'public' | 'lofts' = 'public';
  private publicRooms: RoomData[] = [];
  private communityLofts: RoomData[] = [];

  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    document.getElementById('login-panel')?.classList.add('hidden');
    document.getElementById('lobby-panel')?.classList.remove('hidden');

    this.setupUI();
    this.fetchData().catch(console.error);
  }

  private setupUI(): void {
    const tabPublic = document.getElementById('tab-rooms-public');
    const tabLofts = document.getElementById('tab-rooms-lofts');
    const closeBtn = document.getElementById('btn-close-lobby');
    const logoutBtn = document.getElementById('btn-lobby-logout');

    tabPublic?.addEventListener('click', () => {
      this.activeTab = 'public';
      tabPublic.classList.add('tab--active');
      tabLofts?.classList.remove('tab--active');
      this.renderList();
    });

    tabLofts?.addEventListener('click', () => {
      this.activeTab = 'lofts';
      tabLofts?.classList.add('tab--active');
      tabPublic?.classList.remove('tab--active');
      this.renderList();
    });

    closeBtn?.addEventListener('click', () => {
      document.getElementById('lobby-panel')?.classList.add('hidden');
      document.getElementById('game-container')?.classList.remove('hidden');
      // If no RoomScene is active, default to personal loft
      if (!this.scene.isActive('RoomScene')) {
        const user = authService.user;
        const loftId = user?.personalRoom?.id;
        if (loftId) {
          this.enterRoom({ id: loftId, name: 'My Loft', maxOccupants: 10 });
        }
      }
    });

    logoutBtn?.addEventListener('click', () => {
      authService.logout();
      this.scene.stop('RoomScene');
      this.scene.stop('UIScene');
      this.scene.start('LoginScene');
      document.getElementById('lobby-panel')?.classList.add('hidden');
      document.getElementById('game-container')?.classList.add('hidden');
      document.getElementById('room-nav')?.classList.add('hidden');
      document.getElementById('chat-panel')?.classList.add('hidden');
      document.getElementById('player-card')?.classList.add('hidden');
      document.getElementById('avatar-panel')?.classList.add('hidden');
    });
  }

  private async fetchData(): Promise<void> {
    const grid = document.getElementById('room-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="loading-text">Loading directory…</p>';

    try {
      const SERVER = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://147-224-164-228.nip.io' : '');
      const token = authService.token || authService.getToken() || '';

      const [publicRes, loftsRes] = await Promise.all([
        fetch(`${SERVER}/api/rooms`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        }),
        fetch(`${SERVER}/api/rooms?type=lofts`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        }),
      ]);

      if (publicRes.ok) {
        this.publicRooms = await publicRes.json();
      }
      if (loftsRes.ok) {
        this.communityLofts = await loftsRes.json();
      }

      this.renderList();
    } catch (err) {
      console.error('[LobbyScene] Error fetching rooms:', err);
      grid.innerHTML = `<p class="error-text">Failed to load directory. <button id="retry-rooms">Retry</button></p>`;
      document.getElementById('retry-rooms')?.addEventListener('click', () => {
        this.fetchData().catch(console.error);
      });
    }
  }

  private renderList(): void {
    const grid = document.getElementById('room-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const items = this.activeTab === 'public' ? this.publicRooms : this.communityLofts;

    if (items.length === 0) {
      grid.innerHTML = `<p class="loading-text">No ${this.activeTab === 'public' ? 'public rooms' : 'community lofts'} available.</p>`;
      return;
    }

    for (const room of items) {
      const card = this.buildRoomCard(room);
      grid.appendChild(card);
    }
  }

  private buildRoomCard(room: RoomData): HTMLElement {
    const card = document.createElement('div');
    card.className = 'room-card';

    const occupants = room.occupants ?? room.players?.length ?? 0;
    const capacity = room.maxOccupants ?? room.capacity ?? 10;
    const mapDisplay = room.id === 'room-park' ? 'Community Space' : (room.theme || 'Personal Loft');
    const isOwner = authService.user?.personalRoom?.id === room.id;

    card.innerHTML = `
      <div class="room-card__name">${escapeHtml(room.name)} ${isOwner ? '<span style="font-size:0.75rem; color:#4ecdc4;">(Your Loft)</span>' : ''}</div>
      <div class="room-card__info">
        <span class="room-card__players">${occupants} / ${capacity}</span>
        <span class="room-card__map">${escapeHtml(mapDisplay)}</span>
      </div>
      <button class="btn btn--teal room-card__join">${isOwner ? 'Enter' : 'Visit'}</button>
    `;

    card.querySelector('.room-card__join')?.addEventListener('click', () => {
      this.enterRoom(room);
    });

    return card;
  }

  private enterRoom(room: RoomData): void {
    document.getElementById('lobby-panel')?.classList.add('hidden');
    document.getElementById('game-container')?.classList.remove('hidden');

    const mapKey = (room.id === 'room-park' || room.id.includes('park')) ? 'park' : 'personal-room';
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
