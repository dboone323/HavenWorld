import Phaser from 'phaser';
import type { ChatMessage } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/events';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';

const MAX_LOG_ENTRIES = 50;
const RATE_ERR_DURATION = 4000; // ms

/**
 * UIScene — parallel HUD overlay scene.
 *
 * Handles:
 * - Chat input (send button + Enter key)
 * - Rendering chat messages in #chat-log
 * - Displaying rate-limit error notices in #chat-error
 */
export class UIScene extends Phaser.Scene {
  private logEntries: ChatMessage[] = [];
  private unsubs:     Array<() => void> = [];
  private errTimer:   ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({ key: 'UIScene', active: false });
  }

  create(): void {
    this.mountChatHandlers();

    // ── Socket listeners ──────────────────────────────────────────────────
    this.unsubs.push(
      socketService.on<ChatMessage>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
        this.appendChatMessage(msg);
      }),
      socketService.on<{ message: string }>(SOCKET_EVENTS.CHAT_ERROR, ({ message }) => {
        this.showChatError(message);
      }),
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private mountChatHandlers(): void {
    const input  = document.getElementById('chat-input')  as HTMLInputElement | null;
    const sendBtn = document.getElementById('chat-send')  as HTMLButtonElement | null;

    if (!input || !sendBtn) return;

    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      socketService.emit(SOCKET_EVENTS.CHAT_SEND, { text });
      input.value = '';
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  private appendChatMessage(msg: ChatMessage): void {
    this.logEntries.push(msg);
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries.shift();
    }

    const log = document.getElementById('chat-log');
    if (!log) return;

    const entry = document.createElement('div');
    entry.className = 'chat-log__entry';
    const isOwn = msg.playerId === authService.user?.id;
    entry.classList.toggle('chat-log__entry--own', isOwn);
    entry.innerHTML = `<span class="chat-log__username">${escapeHtml(msg.username)}</span>: ${escapeHtml(msg.text)}`;
    log.appendChild(entry);

    // Auto-scroll to bottom
    log.scrollTop = log.scrollHeight;

    // Trim DOM if over limit
    while (log.children.length > MAX_LOG_ENTRIES) {
      log.removeChild(log.firstElementChild!);
    }
  }

  private showChatError(message: string): void {
    const el = document.getElementById('chat-error');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    if (this.errTimer) clearTimeout(this.errTimer);
    this.errTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, RATE_ERR_DURATION);
  }

  override shutdown(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    if (this.errTimer) clearTimeout(this.errTimer);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
