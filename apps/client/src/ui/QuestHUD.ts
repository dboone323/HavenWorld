import type { DailyQuestProgressData } from '@havenworld/shared';
import { authService } from '../services/auth';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';
import { SERVER_URL } from '../config';

export class QuestHUD {
  private container: HTMLElement | null = null;
  private quests: DailyQuestProgressData[] = [];
  private isCollapsed = true;

  constructor() {
    this.createWidget();
    this.loadQuests();
    this.setupSocketListeners();
  }

  private createWidget(): void {
    this.container = document.createElement('div');
    this.container.id = 'quest-hud';
    this.container.style.cssText = `
      position: fixed;
      top: 66px;
      right: 80px;
      width: 220px;
      background: rgba(26, 26, 46, 0.9);
      border: 1px solid #4ecdc4;
      border-radius: 8px;
      padding: 8px 12px;
      color: #e2e8f0;
      font-family: Calibri, sans-serif;
      z-index: 80;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      transition: all 200ms;
    `;

    document.body.appendChild(this.container);
    this.render();
  }

  private async loadQuests(): Promise<void> {
    const token = await authService.getToken();
    if (!token) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/quests`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        this.quests = await res.json();
        this.render();
      }
    } catch {
      /* ignore */
    }
  }

  private setupSocketListeners(): void {
    socketService.on<{ questId: string; progress: number; goal: number; completed: boolean }>(
      SOCKET_EVENTS.QUEST_PROGRESS_UPDATE,
      (data) => {
        const q = this.quests.find((item) => item.questId === data.questId);
        if (q) {
          q.progress = data.progress;
          q.completed = data.completed;
          this.render();
        }
      }
    );

    socketService.on<{ questId: string; title: string; rewardCoins: number; rewardGems: number }>(
      SOCKET_EVENTS.QUEST_COMPLETE,
      (data) => {
        audioEngine.playFishingCatch();
        const q = this.quests.find((item) => item.questId === data.questId);
        if (q) {
          q.completed = true;
          this.render();
        }
      }
    );
  }

  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" id="quest-hud-header">
        <span style="font-weight: 600; color: #4ecdc4; font-size: 0.95rem;">📜 Daily Quests</span>
        <span style="font-size: 0.8rem; color: #888;">${this.isCollapsed ? '▼' : '▲'}</span>
      </div>
      <div id="quest-list" style="margin-top: 8px; display: ${this.isCollapsed ? 'none' : 'block'};">
        ${
          this.quests.length === 0
            ? '<p style="font-size: 0.8rem; color: #888;">Loading quests...</p>'
            : this.quests
                .map(
                  (q) => `
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #2a2a4a;">
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
              <span style="${q.completed ? 'text-decoration: line-through; color: #888;' : ''}">${q.title}</span>
              <span style="color: #ffd700; font-size: 0.75rem;">+${q.rewardCoins} 🪙</span>
            </div>
            <div style="background: #111; height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden;">
              <div style="width: ${Math.min(100, Math.round((q.progress / q.goal) * 100))}%; height: 100%; background: ${q.completed ? '#4ecdc4' : '#ffaa00'};"></div>
            </div>
            <div style="font-size: 0.7rem; color: #777; margin-top: 2px;">${q.progress} / ${q.goal}</div>
          </div>
        `
                )
                .join('')
        }
      </div>
    `;

    this.container.querySelector('#quest-hud-header')?.addEventListener('click', () => {
      this.isCollapsed = !this.isCollapsed;
      this.render();
    });
  }

  dispose(): void {
    this.container?.remove();
    this.container = null;
  }
}
