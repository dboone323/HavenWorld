import { authService } from '../services/auth';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { SERVER_URL } from '../config';
import { showToast } from './ToastNotification';
import { SceneManager } from '../engine/SceneManager';
import { PassportModal } from '../passport/PassportModal';

export interface RoomOccupant {
  id: string;
  username: string;
  isSelf: boolean;
  position?: { x: number; y: number; z: number };
}

export class PlayersListModal {
  private static instance: HTMLElement | null = null;

  static show(occupants: RoomOccupant[], onFollow?: (targetId: string) => void): void {
    PlayersListModal.dismiss();

    const overlay = document.createElement('div');
    overlay.id = 'players-list-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
      animation: modalFadeIn 0.15s ease-out;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #4ecdc4;
      border-radius: 12px;
      width: min(440px, 92vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      color: #e0e0e0;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 14px 18px;
      background: #16213e;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.2rem;">👥</span>
        <h3 style="margin: 0; font-size: 1.1rem; color: #4ecdc4;">Room Occupants (${occupants.length})</h3>
      </div>
      <button id="btn-close-players-list" style="background: none; border: none; color: #888; font-size: 1.2rem; cursor: pointer;">✕</button>
    `;

    // Body / Occupant Rows
    const body = document.createElement('div');
    body.style.cssText = `
      padding: 12px 18px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    for (const player of occupants) {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: #161b33;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      `;

      const info = document.createElement('div');
      info.style.cssText = 'display: flex; align-items: center; gap: 8px;';
      info.innerHTML = `
        <span style="font-size: 1.1rem;">${player.isSelf ? '⭐' : '👤'}</span>
        <span style="font-weight: 600; color: ${player.isSelf ? '#ffd700' : '#fff'};">
          ${player.username} ${player.isSelf ? '<span style="font-size: 0.75rem; color: #aaa;">(You)</span>' : ''}
        </span>
      `;
      row.appendChild(info);

      if (!player.isSelf) {
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 6px;';

        // Follow Button
        const btnFollow = document.createElement('button');
        btnFollow.style.cssText = 'background: #2563eb; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 600;';
        btnFollow.textContent = 'Follow';
        btnFollow.title = 'Walk toward this player';
        btnFollow.addEventListener('click', () => {
          PlayersListModal.dismiss();
          onFollow?.(player.id);
        });
        actions.appendChild(btnFollow);

        // Trade Button
        const btnTrade = document.createElement('button');
        btnTrade.style.cssText = 'background: #059669; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 600;';
        btnTrade.textContent = 'Trade';
        btnTrade.addEventListener('click', () => {
          PlayersListModal.dismiss();
          socketService.emit(SOCKET_EVENTS.TRADE_REQUEST, { targetUserId: player.id });
        });
        actions.appendChild(btnTrade);

        // Message Button
        const btnMsg = document.createElement('button');
        btnMsg.style.cssText = 'background: #0891b2; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 600;';
        btnMsg.textContent = 'Msg';
        btnMsg.title = 'Send Direct Message';
        btnMsg.addEventListener('click', async () => {
          PlayersListModal.dismiss();
          const { DirectMessagePanel } = await import('./DirectMessagePanel');
          const panel = DirectMessagePanel.getInstance() || new DirectMessagePanel();
          panel.open(player.id, player.username);
        });
        actions.appendChild(btnMsg);

        // Visit Button
        const btnVisit = document.createElement('button');
        btnVisit.style.cssText = 'background: #7c3aed; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 600;';
        btnVisit.textContent = 'Visit';
        btnVisit.addEventListener('click', async () => {
          PlayersListModal.dismiss();
          try {
            const res = await fetch(`${SERVER_URL}/api/users/id/${player.id}/room`, {
              headers: { Authorization: `Bearer ${authService.token || ''}` },
            });
            if (!res.ok) {
              showToast({ icon: '🏠', title: 'Visit Failed', subtitle: 'Player has no personal room' });
              return;
            }
            const room = await res.json();
            const tpRes = await fetch(`${SERVER_URL}/api/rooms/${room.id}/teleport`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authService.token || ''}`,
              },
              body: JSON.stringify({ targetRoomId: room.id }),
            });
            const tpData = await tpRes.json();
            if (!tpRes.ok || !tpData.allowed) {
              showToast({ icon: '🔒', title: 'Cannot Visit', subtitle: tpData.reason || 'This loft is private.' });
              return;
            }
            showToast({ icon: '🚀', title: 'Visiting Loft', subtitle: `Entering ${player.username}'s loft` });
            SceneManager.getInstance().switchTo('room', {
              roomId: room.id,
              isVisiting: true,
              visitedHostName: player.username,
            }).catch(console.error);
          } catch {
            showToast({ icon: '⚠️', title: 'Visit Error', subtitle: 'Failed to visit player room' });
          }
        });
        actions.appendChild(btnVisit);

        row.appendChild(actions);
      }

      body.appendChild(row);
    }

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    PlayersListModal.instance = overlay;

    header.querySelector('#btn-close-players-list')?.addEventListener('click', () => {
      PlayersListModal.dismiss();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        PlayersListModal.dismiss();
      }
    });
  }

  static dismiss(): void {
    if (PlayersListModal.instance) {
      PlayersListModal.instance.remove();
      PlayersListModal.instance = null;
    }
  }
}
