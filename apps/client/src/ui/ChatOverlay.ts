import type { ChatMessage } from '@havenworld/shared';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';

const MAX_LOG_ENTRIES = 50;
const RATE_ERR_DURATION = 4000;

export class ChatOverlay {
  private _unsubs: Array<() => void> = [];
  private _errTimer: ReturnType<typeof setTimeout> | null = null;
  private _onMessageCb?: (msg: ChatMessage) => void;
  private _handleSendBound: () => void;
  private _handleKeyDownBound: (e: KeyboardEvent) => void;

  constructor(onMessage?: (msg: ChatMessage) => void) {
    this._onMessageCb = onMessage;
    this._handleSendBound = this._handleSend.bind(this);
    this._handleKeyDownBound = this._handleKeyDown.bind(this);
    this._mount();
  }

  private _mount(): void {
    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    const sendBtn = document.getElementById('chat-send') as HTMLButtonElement | null;
    const panel = document.getElementById('chat-panel');

    if (panel) {
      panel.classList.remove('hidden');
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', this._handleSendBound);
    }
    if (input) {
      input.addEventListener('keydown', this._handleKeyDownBound);
    }

    // Socket listeners
    this._unsubs.push(
      socketService.on<ChatMessage>(SOCKET_EVENTS.CHAT_MESSAGE, (msg) => {
        this.appendMessage(msg);
        if (this._onMessageCb) {
          this._onMessageCb(msg);
        }
      }),
      socketService.on<{ message: string }>(SOCKET_EVENTS.CHAT_ERROR, ({ message }) => {
        this.showError(message);
      })
    );
  }

  private _handleSend(): void {
    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    socketService.emit(SOCKET_EVENTS.CHAT_SEND, { text });
    input.value = '';
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._handleSend();
    }
  }

  public appendMessage(msg: ChatMessage): void {
    const log = document.getElementById('chat-log');
    if (!log) return;

    const entry = document.createElement('div');
    entry.className = 'chat-log__entry';
    const isOwn = msg.playerId === authService.user?.id;
    entry.classList.toggle('chat-log__entry--own', isOwn);
    entry.innerHTML = `<span class="chat-log__username">${this._escapeHtml(msg.username)}</span>: ${this._escapeHtml(msg.text)}`;
    log.appendChild(entry);

    log.scrollTop = log.scrollHeight;

    while (log.children.length > MAX_LOG_ENTRIES) {
      log.removeChild(log.firstElementChild!);
    }
  }

  public showError(message: string): void {
    const el = document.getElementById('chat-error');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    if (this._errTimer) clearTimeout(this._errTimer);
    this._errTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, RATE_ERR_DURATION);
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public dispose(): void {
    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    const sendBtn = document.getElementById('chat-send') as HTMLButtonElement | null;
    if (sendBtn) {
      sendBtn.removeEventListener('click', this._handleSendBound);
    }
    if (input) {
      input.removeEventListener('keydown', this._handleKeyDownBound);
    }

    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];

    if (this._errTimer) {
      clearTimeout(this._errTimer);
      this._errTimer = null;
    }

    const panel = document.getElementById('chat-panel');
    if (panel) {
      panel.classList.add('hidden');
    }
  }
}
