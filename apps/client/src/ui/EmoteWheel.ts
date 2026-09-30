import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';
import { showToast } from './ToastNotification';

export interface EmoteDefinition {
  id: string;
  name: string;
  icon: string;
  /**
   * true = requires server-side unlock (Phase 3B EmoteProgressionService).
   * Rendered with a lock badge until EMOTE_STATE says otherwise.
   */
  unlockable?: boolean;
}

export const EMOTE_LIST: EmoteDefinition[] = [
  { id: 'wave', name: 'Wave', icon: '👋' },
  { id: 'dance', name: 'Dance', icon: '💃' },
  { id: 'laugh', name: 'Laugh', icon: '😂' },
  { id: 'cry', name: 'Cry', icon: '😭' },
  { id: 'shrug', name: 'Shrug', icon: '🤷' },
  { id: 'clap', name: 'Clap', icon: '👏' },
  { id: 'thumbs_up', name: 'Thumbs Up', icon: '👍' },
  { id: 'bow', name: 'Bow', icon: '🙇' },
  { id: 'sit', name: 'Sit', icon: '🧘' },
  { id: 'sleep', name: 'Sleep', icon: '💤' },
  { id: 'heart', name: 'Heart', icon: '💖' },
  { id: 'spin', name: 'Spin', icon: '🌀' },
  { id: 'backflip', name: 'Acrobatic Backflip', icon: '🤸', unlockable: true },
  { id: 'handstand', name: 'Handstand Balance', icon: '🤾', unlockable: true },
  { id: 'confetti', name: 'Party Confetti Blast', icon: '🎉', unlockable: true },
];

interface ServerEmoteInfo {
  id: string;
  unlocked: boolean;
  requirementDescription?: string;
}

export class EmoteWheel {
  private overlay: HTMLElement | null = null;
  private isOpen = false;

  /** Server-authoritative unlock state, keyed by emote id. Empty = never fetched. */
  private unlockState = new Map<string, ServerEmoteInfo>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Toggle on 'E' key when not typing in chat
      if (e.key.toLowerCase() === 'e' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Phase 3B: keep the unlock list warm, and live-refresh the wheel if open
    socketService.on<{ emotes: ServerEmoteInfo[] }>(SOCKET_EVENTS.EMOTE_STATE, (state) => {
      if (!Array.isArray(state?.emotes)) return;
      for (const emote of state.emotes) {
        this.unlockState.set(emote.id, emote);
      }
      if (this.isOpen) {
        this.close();
        this.open();
      }
    });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    // Ask the server for the authoritative unlock list (replies via EMOTE_STATE)
    socketService.emit(SOCKET_EVENTS.EMOTE_LIST);

    this.overlay = document.createElement('div');
    this.overlay.id = 'emote-wheel-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      backdrop-filter: blur(2px);
    `;

    const wheel = document.createElement('div');
    wheel.style.cssText = `
      position: relative;
      width: 320px;
      height: 320px;
      border-radius: 50%;
      background: rgba(26, 26, 46, 0.85);
      border: 2px solid #4ecdc4;
      box-shadow: 0 0 24px rgba(78, 205, 196, 0.35);
    `;

    // Center icon
    const center = document.createElement('div');
    center.textContent = '🎭';
    center.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 2rem;
      user-select: none;
    `;
    wheel.appendChild(center);

    // Place items radially, evenly spaced regardless of list length
    const radius = 115;
    const step = 360 / EMOTE_LIST.length;
    EMOTE_LIST.forEach((emote, idx) => {
      const angle = (idx * step - 90) * (Math.PI / 180);
      const x = 160 + radius * Math.cos(angle) - 24;
      const y = 160 + radius * Math.sin(angle) - 24;
      const locked = this.isLocked(emote);

      const btn = document.createElement('button');
      btn.textContent = emote.icon;
      btn.title = locked
        ? `${emote.name} — 🔒 ${this.requirementFor(emote)}`
        : emote.name;
      btn.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #16213e;
        border: 1px solid ${locked ? '#555a7a' : '#4ecdc4'};
        font-size: 1.4rem;
        cursor: ${locked ? 'not-allowed' : 'pointer'};
        opacity: ${locked ? '0.45' : '1'};
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 120ms, background 120ms;
      `;

      if (locked) {
        // Lock badge in the corner of the slot
        const badge = document.createElement('span');
        badge.textContent = '🔒';
        badge.style.cssText = `
          position: absolute;
          right: -2px;
          bottom: -2px;
          font-size: 0.75rem;
          pointer-events: none;
        `;
        btn.appendChild(badge);
      }

      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.25)';
        if (!locked) btn.style.background = '#4ecdc4';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        if (!locked) btn.style.background = '#16213e';
      });

      btn.addEventListener('click', () => {
        if (locked) {
          showToast({
            icon: '🔒',
            title: `${emote.name} is locked`,
            subtitle: this.requirementFor(emote),
            durationMs: 3000,
          });
          return;
        }
        this.triggerEmote(emote.id);
        this.close();
      });

      wheel.appendChild(btn);
    });

    this.overlay.appendChild(wheel);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    document.body.appendChild(this.overlay);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay?.remove();
    this.overlay = null;
  }

  /**
   * Locked = server-listed unlockable emote that has not yet been reported
   * unlocked. Unknown ids fail OPEN so a telemetry hiccup never blocks play.
   */
  private isLocked(emote: EmoteDefinition): boolean {
    if (!emote.unlockable) return false;
    const info = this.unlockState.get(emote.id);
    return info ? !info.unlocked : false;
  }

  private requirementFor(emote: EmoteDefinition): string {
    return this.unlockState.get(emote.id)?.requirementDescription || 'Keep playing to unlock!';
  }

  private triggerEmote(emoteId: string): void {
    socketService.emit(SOCKET_EVENTS.EMOTE_TRIGGERED, { emoteId });
    audioEngine.playPetHappy();
  }
}
