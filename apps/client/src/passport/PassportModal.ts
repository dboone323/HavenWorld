import { authService } from '../services/auth';
import type { PassportData, AvatarData } from '@havenworld/shared';
import { SERVER_URL, assetUrl } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { DraggablePanel } from '../ui/DraggablePanel';

export const STAMP_NAMES = [
  'First Step',
  'World Traveler',
  'Master Angler',
  'Friendly Spirit',
  'Sanctuary Decorator',
  'Social Butterfly',
  'Tip Royale',
  'Craft Master',
  'Pizza Pro',
  'Fish and Chips',
  'Streaker',
  'Legendary Catch',
  'Club Founder',
  'Pet Parent',
  'Dragon Tamer',
  'Trading Post',
  'Generous Soul',
  'Good Neighbor',
  'Loyal Haven',
  'Legend of Haven',
];

export class PassportModal {
  private overlay: HTMLElement | null = null;

  async open(targetUserId?: string): Promise<void> {
    const userId = targetUserId || authService.user?.id;
    if (!userId || this.overlay) return;

    const token = authService.token || (await authService.getToken()) || '';

    try {
      const res = await fetch(`${SERVER_URL}/api/passport/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!res.ok) {
        alert('Could not load passport');
        return;
      }

      const passport: PassportData = await res.json();
      this.render(passport);
    } catch {
      alert('Failed to connect to passport service');
    }
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  public renderAvatarBadge(avatar?: AvatarData): string {
    const sheetW = 1774;
    const sheetH = 887;
    const cols = 6;
    const rows = 3;
    const cellRow = 0;
    const cellCol = 0;
    const sourceX0 = Math.round(cellCol * sheetW / cols);
    const sourceX1 = Math.round((cellCol + 1) * sheetW / cols);
    const sourceY0 = Math.round(cellRow * sheetH / rows);
    const sourceY1 = Math.round((cellRow + 1) * sheetH / rows);
    const sourceCellHeight = sourceY1 - sourceY0;

    const displayW = 54;
    const displayH = 68;
    const scale = (displayH * 1.5) / sourceCellHeight;
    const sourceCellCenterX = (sourceX0 + sourceX1) / 2;
    const bgX = (displayW / 2) - (sourceCellCenterX * scale);
    const bgY = -(sourceY0 * scale) + 4;

    const bgSize = `${sheetW * scale}px ${sheetH * scale}px`;
    const bgPos = `${bgX}px ${bgY}px`;

    const layerStyle = `position: absolute; inset: 0; width: 100%; height: 100%; background-repeat: no-repeat; background-size: ${bgSize}; background-position: ${bgPos};`;

    const baseSrc = assetUrl('/assets/sprites/avatar/wearables/MiPlanet Character Base Sprite.png');
    const topSrc = avatar?.outfitBody && avatar.outfitBody !== 'none' && avatar.outfitBody !== 'underwear'
      ? assetUrl('/assets/sprites/avatar/wearables/MiPlanet Pink Llama Sweater.png')
      : '';
    const hairSrc = avatar?.hairStyle && avatar.hairStyle !== 'none' && avatar.hairStyle !== 'bald'
      ? assetUrl('/assets/sprites/avatar/wearables/MiPlanet Wavy Golden Hair.png')
      : '';
    const hatSrc = avatar?.outfitHead && avatar.outfitHead !== 'none'
      ? assetUrl('/assets/sprites/avatar/wearables/MiPlanet Trapper Hat.png')
      : '';
    const eyesSrc = avatar?.eyes
      ? assetUrl('/assets/sprites/avatar/wearables/MiPlanet Basic Blue Eyes.png')
      : '';

    return `
      <div class="passport-avatar-badge" style="position: relative; width: 54px; height: 68px; border-radius: 8px; overflow: hidden; background: radial-gradient(circle, #312e81 0%, #1e1b4b 100%); border: 2px solid #818cf8; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">
        <div style="${layerStyle} background-image: url('${baseSrc}');"></div>
        ${topSrc ? `<div style="${layerStyle} background-image: url('${topSrc}');"></div>` : ''}
        ${eyesSrc ? `<div style="${layerStyle} background-image: url('${eyesSrc}');"></div>` : ''}
        ${hairSrc ? `<div style="${layerStyle} background-image: url('${hairSrc}');"></div>` : ''}
        ${hatSrc ? `<div style="${layerStyle} background-image: url('${hatSrc}');"></div>` : ''}
      </div>
    `;
  }

  private render(passport: PassportData): void {
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'passport-modal-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
    `;

    const earnedStamps = new Set(passport.stamps.map((s) => s.stamp));
    const allStampNames = Array.from(new Set([...STAMP_NAMES, ...earnedStamps]));
    const joinDateStr = new Date(passport.joinDate).toLocaleDateString();

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1e1b4b;
      border: 2px solid #818cf8;
      border-radius: 12px;
      width: min(680px, 94vw);
      max-height: 90vh;
      overflow-y: auto;
      padding: 24px;
      color: #e2e8f0;
      box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3);
    `;

    const avatar = passport.avatar || authService.user?.avatar;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          ${this.renderAvatarBadge(avatar)}
          <div>
            <h2 style="margin: 0; font-size: 1.4rem; color: #a5b4fc;">${escapeHtml(passport.username)}'s Passport</h2>
            <div style="font-size: 0.8rem; color: #94a3b8;">Citizen since ${escapeHtml(joinDateStr)} · ${passport.stamps.length}/${allStampNames.length} Stamps</div>
          </div>
        </div>
        <button id="btn-close-passport" style="background: transparent; border: none; color: #aaa; font-size: 1.4rem; cursor: pointer;">✕</button>
      </div>

      <!-- Stats Row -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
        <div style="background: #312e81; padding: 10px; border-radius: 8px; text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #38bdf8;">${escapeHtml(passport.fishCount)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Fish Caught</div>
        </div>
        <div style="background: #312e81; padding: 10px; border-radius: 8px; text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #ffd700;">${escapeHtml(passport.totalTips)} 🪙</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Loft Tips Received</div>
        </div>
        <div style="background: #312e81; padding: 10px; border-radius: 8px; text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #4ecdc4;">${escapeHtml(passport.completedTrades)}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">Trades Completed</div>
        </div>
      </div>

      <!-- 20-Stamp Grid (4x5) -->
      <div style="font-weight: bold; margin-bottom: 12px; color: #c7d2fe;">Achievement Stamps</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px;">
        ${allStampNames.map((name) => {
          const isEarned = earnedStamps.has(name);
          return `
            <div style="background: ${isEarned ? '#3730a3' : '#1e1b4b'}; border: 1px solid ${isEarned ? '#818cf8' : '#312e81'}; border-radius: 8px; padding: 10px; text-align: center; opacity: ${isEarned ? '1' : '0.45'}; transition: transform 120ms;">
              <div style="font-size: 1.5rem; margin-bottom: 4px;">${isEarned ? '🏅' : '🔒'}</div>
              <div style="font-size: 0.75rem; font-weight: 600; color: #fff;">${escapeHtml(name)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
    DraggablePanel.makeDraggable(panel);

    panel.querySelector('#btn-close-passport')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }
}
