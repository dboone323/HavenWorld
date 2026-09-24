import type { DailyQuestProgressData } from '@havenworld/shared';
import { authService } from '../services/auth';
import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

type QuestPanelStatus = 'idle' | 'loading' | 'error' | 'ready';

export class QuestHUD {
  private container: HTMLElement | null = null;
  private quests: DailyQuestProgressData[] = [];
  private isCollapsed = true;
  private status: QuestPanelStatus = 'idle';
  private static spinnerStylesInjected = false;

  constructor() {
    this.createWidget();
    this.setupSocketListeners();
    this.setupAuthListeners();
    // If a valid session already exists (e.g. restored from a previous visit
    // before the HUD was constructed), load right away instead of silently
    // doing nothing. Otherwise the panel waits for 'auth:login' below.
    if (authService.isAuthenticated()) {
      this.loadQuests();
    }
  }

  private onAuthLogin = (): void => {
    this.loadQuests();
  };

  private onAuthLogout = (): void => {
    this.quests = [];
    this.status = 'idle';
    this.render();
  };

  private createWidget(): void {
    this.injectSpinnerStyles();
    this.container = document.createElement('div');
    this.container.id = 'quest-hud';
    this.container.style.cssText = `
      position: fixed;
      top: 66px;
      right: 80px;
      width: 220px;
      /* The HUD must never swallow clicks meant for the dock buttons beneath it.
         Interactive rows opt back in with pointer-events: auto. */
      pointer-events: none;
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

  /** One-time keyframes for the loading spinner (inline styles can't declare
   *  @keyframes, so they live in a <style> tag). */
  private injectSpinnerStyles(): void {
    if (QuestHUD.spinnerStylesInjected || typeof document === 'undefined') return;
    QuestHUD.spinnerStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = '@keyframes quest-hud-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  /**
   * Reload quests once the user is authenticated. AuthService dispatches
   * 'auth:login' after login, after register, and after a silent session
   * restore (token refresh on page load) — so the panel can never be left
   * stuck in a loading state from a pre-login fetch attempt.
   */
  private setupAuthListeners(): void {
    window.addEventListener('auth:login', this.onAuthLogin);
    window.addEventListener('auth:logout', this.onAuthLogout);
  }

  private async loadQuests(): Promise<void> {
    // Never stack overlapping fetches (e.g. 'auth:login' firing while a
    // session-restore load is still in flight).
    if (this.status === 'loading') return;
    this.status = 'loading';
    this.render();

    const token = await authService.getToken();
    if (!token) {
      this.status = 'error';
      this.render();
      return;
    }

    try {
      const res = await fetch(`${SERVER_URL}/api/quests`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Quest request failed with status ${res.status}`);
      }
      this.quests = await res.json();
      this.status = 'ready';
      this.render();
    } catch {
      this.status = 'error';
      this.render();
      showToast({
        icon: '📜',
        title: 'Could not load daily quests',
        subtitle: 'Use Retry in the quest panel.',
      });
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
      <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; pointer-events: auto;" id="quest-hud-header">
        <span style="font-weight: 600; color: #4ecdc4; font-size: 0.95rem;">📜 Daily Quests</span>
        <span style="font-size: 0.8rem; color: #888;">${this.isCollapsed ? '▼' : '▲'}</span>
      </div>
      <div id="quest-list" style="margin-top: 8px; display: ${this.isCollapsed ? 'none' : 'block'}; pointer-events: auto;">
        ${this.renderListBody()}
      </div>
    `;

    this.container.querySelector('#quest-hud-header')?.addEventListener('click', () => {
      this.isCollapsed = !this.isCollapsed;
      this.render();
    });
    this.container.querySelector('#quest-retry')?.addEventListener('click', () => {
      this.loadQuests();
    });
  }

  /**
   * Body of the quest list for each explicit panel state. The panel always
   * shows exactly one state — it can never be left stuck on a stale
   * "Loading quests..." message.
   */
  private renderListBody(): string {
    if (this.status === 'loading') {
      return `
        <p style="font-size: 0.8rem; color: #888; display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border: 2px solid #4ecdc4; border-top-color: transparent; border-radius: 50%; animation: quest-hud-spin 0.8s linear infinite;"></span>
          Loading quests…
        </p>`;
    }
    if (this.status === 'error') {
      return `
        <div style="text-align: center; padding: 4px 0 8px;">
          <p style="font-size: 0.8rem; color: #f87171; margin: 0 0 8px;">Couldn&rsquo;t load quests.</p>
          <button id="quest-retry" style="background: #4ecdc4; border: none; border-radius: 6px; color: #1a1a2e; font-weight: 700; font-size: 0.8rem; padding: 6px 16px; cursor: pointer;">Retry</button>
        </div>`;
    }
    if (this.status === 'idle') {
      return `<p style="font-size: 0.8rem; color: #888;">Sign in to see your daily quests.</p>`;
    }
    if (this.quests.length === 0) {
      return `<p style="font-size: 0.8rem; color: #888;">No quests today — check back tomorrow.</p>`;
    }
    return this.quests
      .map(
        (q) => `
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #2a2a4a;">
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
              <span style="${q.completed ? 'text-decoration: line-through; color: #888;' : ''}">${escapeHtml(q.title)}</span>
              <span style="color: #ffd700; font-size: 0.75rem;">+${escapeHtml(q.rewardCoins)} 🪙</span>
            </div>
            <div style="background: #111; height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden;">
              <div style="width: ${Math.min(100, Math.round((q.progress / q.goal) * 100))}%; height: 100%; background: ${q.completed ? '#4ecdc4' : '#ffaa00'};"></div>
            </div>
            <div style="font-size: 0.7rem; color: #777; margin-top: 2px;">${escapeHtml(q.progress)} / ${escapeHtml(q.goal)}</div>
          </div>
        `
      )
      .join('');
  }

  dispose(): void {
    window.removeEventListener('auth:login', this.onAuthLogin);
    window.removeEventListener('auth:logout', this.onAuthLogout);
    this.container?.remove();
    this.container = null;
  }
}
