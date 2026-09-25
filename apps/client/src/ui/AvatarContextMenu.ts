import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { PassportModal } from '../passport/PassportModal';
import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { showToast } from './ToastNotification';
import { SceneManager } from '../engine/SceneManager';

interface ContextMenuOptions {
  x: number;
  y: number;
  targetUserId: string;
  targetUsername: string;
  isSelf?: boolean;
  onClose?: () => void;
}

export class AvatarContextMenu {
  private static activeMenu: HTMLElement | null = null;

  static show(options: ContextMenuOptions): void {
    AvatarContextMenu.dismiss();

    const menu = document.createElement('div');
    menu.id = 'avatar-context-menu';
    menu.className = 'mp-context';
    menu.style.left = `${Math.max(12, Math.min(options.x, window.innerWidth - 230))}px`;
    menu.style.top = `${Math.max(12, Math.min(options.y, window.innerHeight - 250))}px`;

    const header = document.createElement('strong');
    header.textContent = options.targetUsername;
    menu.appendChild(header);

    if (options.isSelf) {
      // Wardrobe Button
      const btnWardrobe = document.createElement('button');
      btnWardrobe.className = 'context-menu-item';
      btnWardrobe.innerHTML = '<span>👗</span> Wardrobe & Style';
      btnWardrobe.addEventListener('click', () => {
        AvatarContextMenu.dismiss();
        document.getElementById('btn-wardrobe')?.click();
      });
      menu.appendChild(btnWardrobe);

      // Decorate Loft Button
      const btnDecorate = document.createElement('button');
      btnDecorate.className = 'context-menu-item';
      btnDecorate.innerHTML = '<span>🛋️</span> Decorate Loft';
      btnDecorate.addEventListener('click', () => {
        AvatarContextMenu.dismiss();
        document.getElementById('btn-decorate')?.click();
      });
      menu.appendChild(btnDecorate);

      // Inspect Passport Button
      const btnPassport = document.createElement('button');
      btnPassport.className = 'context-menu-item';
      btnPassport.innerHTML = '<span>🛂</span> My Passport';
      btnPassport.addEventListener('click', () => {
        new PassportModal().open(options.targetUserId);
        AvatarContextMenu.dismiss();
      });
      menu.appendChild(btnPassport);
    } else {
      // Trade Button
      const btnTrade = document.createElement('button');
      btnTrade.className = 'context-menu-item';
      btnTrade.innerHTML = '<span>🤝</span> Trade';
      btnTrade.addEventListener('click', () => {
        socketService.emit(SOCKET_EVENTS.TRADE_REQUEST, { targetUserId: options.targetUserId });
        AvatarContextMenu.dismiss();
      });
      menu.appendChild(btnTrade);

      // Direct Message Button
      const btnMessage = document.createElement('button');
      btnMessage.className = 'context-menu-item';
      btnMessage.innerHTML = '<span>✉️</span> Message';
      btnMessage.addEventListener('click', async () => {
        AvatarContextMenu.dismiss();
        const { DirectMessagePanel } = await import('./DirectMessagePanel');
        const panel = DirectMessagePanel.getInstance() || new DirectMessagePanel();
        panel.open(options.targetUserId, options.targetUsername);
      });
      menu.appendChild(btnMessage);

      // Add Friend Button
      const btnFriend = document.createElement('button');
      btnFriend.className = 'context-menu-item';
      btnFriend.innerHTML = '<span>👋</span> Add Friend';
      btnFriend.addEventListener('click', async () => {
        try {
          const res = await fetch(`${SERVER_URL}/api/friends/request`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authService.token || ''}`,
            },
            body: JSON.stringify({ targetUserId: options.targetUserId }),
          });
          const data = await res.json();
          if (res.ok) {
            showToast({ icon: '👋', title: 'Friend Request Sent', subtitle: `Sent to ${options.targetUsername}` });
          } else {
            showToast({ icon: '⚠️', title: 'Friend Request', subtitle: data.error || 'Could not send request' });
          }
        } catch {
          showToast({ icon: '⚠️', title: 'Error', subtitle: 'Network error sending request' });
        }
        AvatarContextMenu.dismiss();
      });
      menu.appendChild(btnFriend);

      // Visit Room Button
      const btnVisit = document.createElement('button');
      btnVisit.className = 'context-menu-item';
      btnVisit.innerHTML = '<span>🏠</span> Visit Room';
      btnVisit.addEventListener('click', async () => {
        AvatarContextMenu.dismiss();
        try {
          const res = await fetch(`${SERVER_URL}/api/users/id/${options.targetUserId}/room`, {
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
          showToast({ icon: '🚀', title: 'Visiting Loft', subtitle: `Entering ${options.targetUsername}'s loft` });
          SceneManager.getInstance().switchTo('room', {
            roomId: room.id,
            isVisiting: true,
            visitedHostName: options.targetUsername,
          }).catch(console.error);
        } catch (err) {
          showToast({ icon: '⚠️', title: 'Visit Error', subtitle: 'Failed to visit player room' });
        }
      });
      menu.appendChild(btnVisit);

      // Inspect Passport Button
      const btnPassport = document.createElement('button');
      btnPassport.className = 'context-menu-item';
      btnPassport.innerHTML = '<span>🛂</span> Inspect Passport';
      btnPassport.addEventListener('click', () => {
        new PassportModal().open(options.targetUserId);
        AvatarContextMenu.dismiss();
      });
      menu.appendChild(btnPassport);

      // Report Player Button
      const btnReport = document.createElement('button');
      btnReport.className = 'context-menu-item danger';
      btnReport.innerHTML = '<span>⚠️</span> Report';
      btnReport.addEventListener('click', async () => {
        const reason = prompt(`Report ${options.targetUsername} for inappropriate behavior:`);
        if (reason && reason.trim()) {
          try {
            const res = await fetch(`${SERVER_URL}/api/reports`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authService.token || ''}`,
              },
              body: JSON.stringify({
                reportedUserId: options.targetUserId,
                reason: reason.trim(),
                category: 'HARASSMENT',
              }),
            });
            if (res.ok) {
              showToast({ icon: '🛡️', title: 'Report Submitted', subtitle: 'Report submitted to moderation team.' });
            } else {
              showToast({ icon: '⚠️', title: 'Report Failed', subtitle: 'Could not submit report.' });
            }
          } catch {
            showToast({ icon: '⚠️', title: 'Error', subtitle: 'Network error submitting report.' });
          }
        }
        AvatarContextMenu.dismiss();
      });
      menu.appendChild(btnReport);
    }

    document.body.appendChild(menu);
    AvatarContextMenu.activeMenu = menu;

    // Adjust position if offscreen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 12}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 12}px`;
    }

    const onOutsideClick = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        AvatarContextMenu.dismiss();
        window.removeEventListener('pointerdown', onOutsideClick);
        options.onClose?.();
      }
    };
    setTimeout(() => {
      window.addEventListener('pointerdown', onOutsideClick);
    }, 10);
  }

  static dismiss(): void {
    if (AvatarContextMenu.activeMenu) {
      AvatarContextMenu.activeMenu.remove();
      AvatarContextMenu.activeMenu = null;
    }
  }
}
