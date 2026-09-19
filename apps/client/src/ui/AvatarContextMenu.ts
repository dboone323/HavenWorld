import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { PassportModal } from '../passport/PassportModal';

interface ContextMenuOptions {
  x: number;
  y: number;
  targetUserId: string;
  targetUsername: string;
  onClose?: () => void;
}

export class AvatarContextMenu {
  private static activeMenu: HTMLElement | null = null;

  static show(options: ContextMenuOptions): void {
    AvatarContextMenu.dismiss();

    const menu = document.createElement('div');
    menu.id = 'avatar-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${options.x}px;
      top: ${options.y}px;
      background: rgba(22, 22, 38, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 10000;
      min-width: 170px;
      color: #fff;
      font-family: inherit;
      backdrop-filter: blur(8px);
      animation: menuFadeIn 0.15s ease-out;
    `;

    // Add inline keyframe animation if not already present
    if (!document.getElementById('avatar-context-style')) {
      const style = document.createElement('style');
      style.id = 'avatar-context-style';
      style.textContent = `
        @keyframes menuFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .context-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 500;
          transition: background 0.15s;
          border: none;
          background: transparent;
          color: #eee;
          text-align: left;
          width: 100%;
        }
        .context-menu-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        .context-menu-item.danger:hover {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }
      `;
      document.head.appendChild(style);
    }

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 6px 12px 4px;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    header.textContent = options.targetUsername;
    menu.appendChild(header);

    // Trade Button
    const btnTrade = document.createElement('button');
    btnTrade.className = 'context-menu-item';
    btnTrade.innerHTML = '<span>🤝</span> Trade';
    btnTrade.addEventListener('click', () => {
      socketService.emit(SOCKET_EVENTS.TRADE_REQUEST, { targetUserId: options.targetUserId });
      AvatarContextMenu.dismiss();
    });
    menu.appendChild(btnTrade);

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
    btnReport.addEventListener('click', () => {
      const reason = prompt(`Report ${options.targetUsername} for inappropriate behavior:`);
      if (reason && reason.trim()) {
        const { API_URL } = require('../config');
        const { authService } = require('../services/auth');
        fetch(`${API_URL}/reports`, {
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
        }).then(() => alert('Report submitted to moderation team.'))
          .catch(() => alert('Failed to submit report.'));
      }
      AvatarContextMenu.dismiss();
    });
    menu.appendChild(btnReport);

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
