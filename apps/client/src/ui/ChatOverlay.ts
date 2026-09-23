import type { ChatMessage } from '@havenworld/shared';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { socketService } from '../services/socket';
import { authService } from '../services/auth';
import { escapeHtml } from '../utils/escapeHtml';

const MAX_LOG_ENTRIES = 50;
const RATE_ERR_DURATION = 4000;

export class ChatOverlay {
  private _container: HTMLElement;
  private _unsubs: Array<() => void> = [];
  private _errTimer: ReturnType<typeof setTimeout> | null = null;
  private _cooldownUntil = 0;
  private _onMessageCb?: (msg: ChatMessage) => void;
  private _handleSendBound: () => void;
  private _handleKeyDownBound: (e: KeyboardEvent) => void;

  constructor(container?: HTMLElement | null, onMessage?: (msg: ChatMessage) => void) {
    this._container = container || (typeof document !== 'undefined' ? document.body : (null as any));
    this._onMessageCb = onMessage;
    this._handleSendBound = this._handleSend.bind(this);
    this._handleKeyDownBound = this._handleKeyDown.bind(this);
    if (typeof document !== 'undefined') {
      this._mount();
    }
  }

  private _mount(): void {
    let panel = document.getElementById('chat-panel');
    if (!panel && this._container) {
      panel = document.createElement('div');
      panel.id = 'chat-panel';
      panel.className = 'chat-panel';
      panel.innerHTML = `
        <div id="chat-log" class="chat-log"></div>
        <div id="chat-error" class="chat-error hidden"></div>
        <div class="chat-controls">
          <input id="chat-input" type="text" placeholder="Type a message..." />
          <button id="chat-send">Send</button>
        </div>
      `;
      this._container.appendChild(panel);
    }

    if (panel) {
      panel.classList.remove('hidden');
    }

    const sendBtn = document.getElementById('chat-send') as HTMLButtonElement | null;
    const input = document.getElementById('chat-input') as HTMLInputElement | null;

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
      socketService.on<{ message?: string; code?: string }>(
        SOCKET_EVENTS.CHAT_ERROR,
        (err) => {
          this._cooldownUntil = Date.now() + RATE_ERR_DURATION;
          this.showError(err?.message || 'Chat cooldown active. Please wait...');
        }
      )
    );
  }

  private _handleSend(): void {
    if (Date.now() < this._cooldownUntil) {
      this.showError('Chat cooldown active. Please wait...');
      return;
    }

    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    socketService.emit(SOCKET_EVENTS.CHAT_SEND, { content: text, text });
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
    const isOwn =
      (msg.playerId && msg.playerId === authService.user?.id) ||
      (msg.senderId && msg.senderId === authService.user?.id);
    entry.classList.toggle('chat-log__entry--own', !!isOwn);

    const username = escapeHtml(msg.username || msg.senderName || 'Player');
    const text = escapeHtml(msg.text || msg.content || '');

    entry.innerHTML = `<span class="chat-log__username">${username}</span>: <span class="chat-log__text">${text}</span>`;
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
    return escapeHtml(text);
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
