import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';

export interface EmoteDefinition {
  id: string;
  name: string;
  icon: string;
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
];

export class EmoteWheel {
  private overlay: HTMLElement | null = null;
  private isOpen = false;

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
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

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

    // Place 12 items radially at 30° increments
    const radius = 115;
    EMOTE_LIST.forEach((emote, idx) => {
      const angle = (idx * 30 - 90) * (Math.PI / 180);
      const x = 160 + radius * Math.cos(angle) - 24;
      const y = 160 + radius * Math.sin(angle) - 24;

      const btn = document.createElement('button');
      btn.textContent = emote.icon;
      btn.title = emote.name;
      btn.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #16213e;
        border: 1px solid #4ecdc4;
        font-size: 1.4rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 120ms, background 120ms;
      `;

      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.25)';
        btn.style.background = '#4ecdc4';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        btn.style.background = '#16213e';
      });

      btn.addEventListener('click', () => {
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

  private triggerEmote(emoteId: string): void {
    socketService.emit(SOCKET_EVENTS.EMOTE_TRIGGERED, { emoteId });
    audioEngine.playPetHappy();
  }
}
