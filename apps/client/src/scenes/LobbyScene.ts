import { Scene, Color4 } from '@babylonjs/core';
import type { RoomData } from '@havenworld/shared';
import { HavenEngine } from '../engine/HavenEngine';
import { SceneManager } from '../engine/SceneManager';
import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';

export async function createLobbyScene(haven: HavenEngine): Promise<Scene> {
  const scene = new Scene(haven.engine);
  scene.clearColor = new Color4(0.1, 0.1, 0.18, 1.0);

  document.getElementById('login-panel')?.classList.add('hidden');
  document.getElementById('game-container')?.classList.add('hidden');
  document.getElementById('room-nav')?.classList.add('hidden');
  document.getElementById('chat-panel')?.classList.add('hidden');
  document.getElementById('player-card')?.classList.add('hidden');
  document.getElementById('avatar-panel')?.classList.add('hidden');
  document.getElementById('lobby-panel')?.classList.remove('hidden');

  let activeTab: 'public' | 'lofts' = 'public';
  let publicRooms: RoomData[] = [];
  let communityLofts: RoomData[] = [];

  const tabPublic = document.getElementById('tab-rooms-public');
  const tabLofts = document.getElementById('tab-rooms-lofts');
  const closeBtn = document.getElementById('btn-close-lobby');
  const logoutBtn = document.getElementById('btn-lobby-logout');

  function renderList(): void {
    const grid = document.getElementById('room-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const items = activeTab === 'public' ? publicRooms : communityLofts;

    if (items.length === 0) {
      grid.innerHTML = `<p class="loading-text">No ${activeTab === 'public' ? 'public rooms' : 'community lofts'} available.</p>`;
      return;
    }

    for (const room of items) {
      const card = buildRoomCard(room);
      grid.appendChild(card);
    }
  }

  function buildRoomCard(room: RoomData): HTMLElement {
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

    card.querySelector('.room-card__join')?.addEventListener('click', (e) => {
      e.stopPropagation();
      enterRoom(room);
    });
    card.addEventListener('click', () => {
      enterRoom(room);
    });

    return card;
  }

  function enterRoom(room: RoomData): void {
    document.getElementById('lobby-panel')?.classList.add('hidden');
    SceneManager.getInstance().switchTo('room', { roomId: room.id }).catch(console.error);
  }

  async function fetchData(): Promise<void> {
    const grid = document.getElementById('room-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="loading-text">Loading directory…</p>';

    try {
      const token = authService.token || (await authService.getToken()) || '';

      const [publicRes, loftsRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/rooms`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        }),
        fetch(`${SERVER_URL}/api/rooms?type=lofts`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        }),
      ]);

      if (publicRes.ok) {
        publicRooms = await publicRes.json();
      }
      if (loftsRes.ok) {
        communityLofts = await loftsRes.json();
      }

      renderList();
    } catch (err) {
      console.error('[LobbyScene] Error fetching rooms:', err);
      grid.innerHTML = `<p class="error-text">Failed to load directory. <button id="retry-rooms">Retry</button></p>`;
      document.getElementById('retry-rooms')?.addEventListener('click', () => {
        fetchData().catch(console.error);
      });
    }
  }

  const onTabPublic = () => {
    activeTab = 'public';
    tabPublic?.classList.add('tab--active');
    tabLofts?.classList.remove('tab--active');
    renderList();
  };

  const onTabLofts = () => {
    activeTab = 'lofts';
    tabLofts?.classList.add('tab--active');
    tabPublic?.classList.remove('tab--active');
    renderList();
  };

  const onClose = () => {
    document.getElementById('lobby-panel')?.classList.add('hidden');
    const user = authService.user;
    const loftId = user?.personalRoom?.id || 'room-park';
    SceneManager.getInstance().switchTo('room', { roomId: loftId }).catch(console.error);
  };

  const onLogout = () => {
    authService.logout();
    SceneManager.getInstance().switchTo('login').catch(console.error);
  };

  tabPublic?.addEventListener('click', onTabPublic);
  tabLofts?.addEventListener('click', onTabLofts);
  closeBtn?.addEventListener('click', onClose);
  logoutBtn?.addEventListener('click', onLogout);

  fetchData().catch(console.error);

  scene.onDisposeObservable.add(() => {
    tabPublic?.removeEventListener('click', onTabPublic);
    tabLofts?.removeEventListener('click', onTabLofts);
    closeBtn?.removeEventListener('click', onClose);
    logoutBtn?.removeEventListener('click', onLogout);
    document.getElementById('lobby-panel')?.classList.add('hidden');
  });

  return scene;
}
