import { socketService } from '../services/socket';
import { authService } from '../services/auth';
import { SOCKET_EVENTS, type DirectMessagePayload, type UnreadDMsPayload } from '@havenworld/shared';
import { SERVER_URL } from '../config';
import { escapeHtml } from '../utils/escapeHtml';

export interface DMConversation {
  userId: string;
  username: string;
  unreadCount: number;
  lastMessage?: string;
  lastTimestamp?: string;
}

export class DirectMessagePanel {
  private static instance: DirectMessagePanel | null = null;
  private _container: HTMLElement | null = null;
  private _isOpen = false;
  private _conversations: Map<string, DMConversation> = new Map();
  private _messages: Map<string, DirectMessagePayload[]> = new Map();
  private _activePartnerId: string | null = null;
  private _unsubs: Array<() => void> = [];
  private _onSpeechTrigger?: (senderId: string, content: string) => void;

  private _commonEmojis = ['😊', '😂', '👋', '❤️', '🔥', '✨', '🎉', '👍', '🙏', '🌿', '🍕', '🐱'];

  constructor(onSpeechTrigger?: (senderId: string, content: string) => void) {
    this._onSpeechTrigger = onSpeechTrigger;
    DirectMessagePanel.instance = this;
    this._setupSocketListeners();
  }

  public static getInstance(): DirectMessagePanel | null {
    return DirectMessagePanel.instance;
  }

  public setSpeechTrigger(trigger: (senderId: string, content: string) => void): void {
    this._onSpeechTrigger = trigger;
  }

  private _setupSocketListeners(): void {
    // Receive incoming or echoed DM
    this._unsubs.push(
      socketService.on<DirectMessagePayload>(SOCKET_EVENTS.DM_RECEIVE, (dm) => {
        this.handleIncomingDM(dm);
      })
    );

    // Initial unread DMs payload on login / room join
    this._unsubs.push(
      socketService.on<UnreadDMsPayload>(SOCKET_EVENTS.DM_UNREAD, (payload) => {
        if (!payload || !Array.isArray(payload.recentMessages)) return;
        for (const dm of payload.recentMessages) {
          this._trackMessage(dm, false);
        }
        this._updateUnreadBadge();
        if (this._isOpen) this._render();
      })
    );
  }

  public handleIncomingDM(dm: DirectMessagePayload): void {
    const myId = authService.user?.id;
    const isIncoming = dm.receiverId === myId;
    const partnerId = isIncoming ? dm.senderId : dm.receiverId;
    const partnerName = isIncoming ? dm.senderUsername : (dm.receiverUsername || 'User');

    // Trigger head speech bubble if incoming
    if (isIncoming && this._onSpeechTrigger) {
      this._onSpeechTrigger(dm.senderId, dm.content);
    }

    const isCurrentActive = this._isOpen && this._activePartnerId === partnerId;
    this._trackMessage(dm, isCurrentActive);

    // If active conversation is open, mark read on server immediately
    if (isCurrentActive && isIncoming) {
      socketService.emit(SOCKET_EVENTS.DM_READ, { partnerId });
    }

    this._updateUnreadBadge();
    if (this._isOpen) {
      this._render();
    }
  }

  private _trackMessage(dm: DirectMessagePayload, markRead: boolean): void {
    const myId = authService.user?.id;
    const partnerId = dm.senderId === myId ? dm.receiverId : dm.senderId;
    const partnerName = dm.senderId === myId ? (dm.receiverUsername || 'User') : dm.senderUsername;

    let conv = this._conversations.get(partnerId);
    if (!conv) {
      conv = {
        userId: partnerId,
        username: partnerName,
        unreadCount: 0,
        lastMessage: dm.content,
        lastTimestamp: dm.createdAt,
      };
      this._conversations.set(partnerId, conv);
    }

    let list = this._messages.get(partnerId);
    if (!list) {
      list = [];
      this._messages.set(partnerId, list);
    }

    if (!list.some((m) => m.id === dm.id)) {
      list.push(dm);
      conv.lastMessage = dm.content;
      conv.lastTimestamp = dm.createdAt;
      if (!markRead && dm.receiverId === myId && !dm.read) {
        conv.unreadCount += 1;
      }
    }
  }

  public open(partnerId?: string, partnerUsername?: string): void {
    if (partnerId) {
      this._activePartnerId = partnerId;
      if (!this._conversations.has(partnerId)) {
        this._conversations.set(partnerId, {
          userId: partnerId,
          username: partnerUsername || 'User',
          unreadCount: 0,
        });
      }
      // Mark read and fetch DB history
      this._fetchHistory(partnerId);
      const conv = this._conversations.get(partnerId);
      if (conv) {
        conv.unreadCount = 0;
      }
      socketService.emit(SOCKET_EVENTS.DM_READ, { partnerId });
      this._updateUnreadBadge();
    } else if (!this._activePartnerId && this._conversations.size > 0) {
      this._activePartnerId = this._conversations.keys().next().value || null;
      if (this._activePartnerId) {
        this._fetchHistory(this._activePartnerId);
      }
    }

    this._isOpen = true;
    this._ensureDOM();
    this._render();
  }

  public close(): void {
    this._isOpen = false;
    if (this._container) {
      this._container.remove();
      this._container = null;
    }
  }

  public toggle(partnerId?: string, partnerUsername?: string): void {
    if (this._isOpen) {
      if (partnerId && this._activePartnerId !== partnerId) {
        this.open(partnerId, partnerUsername);
      } else {
        this.close();
      }
    } else {
      this.open(partnerId, partnerUsername);
    }
  }

  private async _fetchHistory(partnerId: string): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/friends/${partnerId}/dms`, {
        headers: { Authorization: `Bearer ${authService.token || ''}` },
      });
      if (res.ok) {
        const history: DirectMessagePayload[] = await res.json();
        const existing = this._messages.get(partnerId) || [];
        const map = new Map<string, DirectMessagePayload>();
        for (const m of [...history, ...existing]) {
          map.set(m.id, m);
        }
        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        this._messages.set(partnerId, merged);
        if (this._isOpen && this._activePartnerId === partnerId) {
          this._renderMessageList();
        }
      }
    } catch {
      // Non-critical network error
    }
  }

  private _ensureDOM(): void {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.id = 'direct-message-panel';
      this._container.style.cssText = `
        position: fixed;
        bottom: 76px;
        right: 20px;
        width: min(480px, 94vw);
        height: 520px;
        background: #12131e;
        border: 1px solid #4ecdc4;
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.75);
        display: flex;
        flex-direction: column;
        z-index: 9995;
        font-family: Calibri, sans-serif;
        color: #eee;
        overflow: hidden;
      `;
      document.body.appendChild(this._container);
    }
  }

  private _render(): void {
    if (!this._container) return;

    this._container.innerHTML = `
      <div style="background: #1a1b2e; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.2rem;">✉️</span>
          <span style="font-weight: bold; color: #4ecdc4; font-size: 1.05rem;">Direct Messages</span>
        </div>
        <button id="btn-close-dm" style="background: none; border: none; color: #888; font-size: 1.2rem; cursor: pointer;">✕</button>
      </div>
      <div style="display: flex; flex: 1; overflow: hidden;">
        <!-- Left Sidebar: Conversations -->
        <div id="dm-conversations-list" style="width: 150px; background: #161726; border-right: 1px solid rgba(255,255,255,0.06); overflow-y: auto; display: flex; flex-direction: column;">
        </div>
        <!-- Right Chat Window -->
        <div style="flex: 1; display: flex; flex-direction: column; background: #0f1019;">
          <div id="dm-active-header" style="padding: 8px 14px; font-weight: 600; font-size: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.05); color: #fff;">
          </div>
          <div id="dm-messages-log" style="flex: 1; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
          </div>
          <!-- Emoji bar -->
          <div id="dm-emoji-bar" style="display: none; padding: 6px 10px; background: #1a1b2e; border-top: 1px solid rgba(255,255,255,0.08); display: flex; gap: 6px; overflow-x: auto;">
          </div>
          <!-- Input row -->
          <div style="padding: 10px; background: #161726; display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
            <button id="btn-dm-emoji" style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer;" title="Insert Emoji">😊</button>
            <input id="dm-input" type="text" placeholder="Type a direct message..." style="flex: 1; background: #0f1019; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff; padding: 8px 12px; outline: none; font-size: 0.9rem;" />
            <button id="btn-dm-send" style="background: #4ecdc4; color: #0f1019; border: none; border-radius: 6px; padding: 8px 14px; font-weight: bold; cursor: pointer;">Send</button>
          </div>
        </div>
      </div>
    `;

    this._container.querySelector('#btn-close-dm')?.addEventListener('click', () => this.close());

    // Render conversations
    const convList = this._container.querySelector('#dm-conversations-list');
    if (convList) {
      if (this._conversations.size === 0) {
        convList.innerHTML = `<div style="padding: 14px 10px; font-size: 0.8rem; color: #777; text-align: center;">No messages yet.</div>`;
      } else {
        convList.innerHTML = '';
        this._conversations.forEach((conv, partnerId) => {
          const item = document.createElement('div');
          const isActive = partnerId === this._activePartnerId;
          item.style.cssText = `
            padding: 10px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            background: ${isActive ? '#202236' : 'transparent'};
            transition: background 0.15s;
          `;
          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 600; font-size: 0.85rem; color: ${isActive ? '#4ecdc4' : '#eee'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(conv.username)}</span>
              ${conv.unreadCount > 0 ? `<span style="background: #ef4444; color: #fff; font-size: 0.7rem; font-weight: bold; border-radius: 10px; padding: 1px 6px;">${conv.unreadCount}</span>` : ''}
            </div>
            ${conv.lastMessage ? `<div style="font-size: 0.75rem; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">${escapeHtml(conv.lastMessage)}</div>` : ''}
          `;
          item.addEventListener('click', () => {
            this.open(partnerId, conv.username);
          });
          convList.appendChild(item);
        });
      }
    }

    // Active conversation header
    const header = this._container.querySelector('#dm-active-header');
    if (header) {
      if (this._activePartnerId) {
        const conv = this._conversations.get(this._activePartnerId);
        header.innerHTML = `Chat with <span style="color: #4ecdc4;">${escapeHtml(conv?.username || 'User')}</span>`;
      } else {
        header.innerHTML = `Select a conversation`;
      }
    }

    // Emoji bar setup
    const emojiBar = this._container.querySelector('#dm-emoji-bar') as HTMLElement;
    if (emojiBar) {
      emojiBar.innerHTML = '';
      for (const emoji of this._commonEmojis) {
        const btn = document.createElement('button');
        btn.style.cssText = 'background: transparent; border: none; font-size: 1.1rem; cursor: pointer; padding: 2px 4px; border-radius: 4px;';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
          const input = this._container?.querySelector('#dm-input') as HTMLInputElement | null;
          if (input) {
            input.value += emoji;
            input.focus();
          }
        });
        emojiBar.appendChild(btn);
      }
    }

    const btnToggleEmoji = this._container.querySelector('#btn-dm-emoji');
    btnToggleEmoji?.addEventListener('click', () => {
      if (emojiBar) {
        emojiBar.style.display = emojiBar.style.display === 'none' ? 'flex' : 'none';
      }
    });

    // Send handling
    const input = this._container.querySelector('#dm-input') as HTMLInputElement | null;
    const btnSend = this._container.querySelector('#btn-dm-send') as HTMLButtonElement | null;

    const sendMessage = () => {
      if (!this._activePartnerId || !input) return;
      const text = input.value.trim();
      if (!text) return;

      socketService.emit(SOCKET_EVENTS.DM_SEND, {
        receiverId: this._activePartnerId,
        content: text,
      });

      input.value = '';
    };

    btnSend?.addEventListener('click', sendMessage);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });

    this._renderMessageList();
  }

  private _renderMessageList(): void {
    if (!this._container || !this._activePartnerId) return;
    const log = this._container.querySelector('#dm-messages-log');
    if (!log) return;

    log.innerHTML = '';
    const messages = this._messages.get(this._activePartnerId) || [];
    const myId = authService.user?.id;

    if (messages.length === 0) {
      log.innerHTML = `<div style="text-align: center; color: #666; font-size: 0.85rem; margin-top: 20px;">No messages in this chat yet. Say hi! 👋</div>`;
      return;
    }

    for (const m of messages) {
      const isMine = m.senderId === myId;
      const bubble = document.createElement('div');
      bubble.style.cssText = `
        max-width: 80%;
        align-self: ${isMine ? 'flex-end' : 'flex-start'};
        background: ${isMine ? '#1e3a5f' : '#1e202e'};
        border: 1px solid ${isMine ? '#3b82f6' : 'rgba(255,255,255,0.08)'};
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 0.88rem;
        word-break: break-word;
      `;

      const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      bubble.innerHTML = `
        <div style="color: ${isMine ? '#93c5fd' : '#4ecdc4'}; font-size: 0.72rem; font-weight: 600; margin-bottom: 2px;">
          ${escapeHtml(m.senderUsername)}
        </div>
        <div style="color: #f1f5f9;">${escapeHtml(m.content)}</div>
        <div style="font-size: 0.65rem; color: rgba(255,255,255,0.4); text-align: right; margin-top: 3px;">
          ${time}
        </div>
      `;
      log.appendChild(bubble);
    }

    log.scrollTop = log.scrollHeight;
  }

  private _updateUnreadBadge(): void {
    let totalUnread = 0;
    this._conversations.forEach((c) => {
      totalUnread += c.unreadCount;
    });

    const badge = document.getElementById('dm-unread-badge');
    if (badge) {
      if (totalUnread > 0) {
        badge.textContent = String(totalUnread);
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  public dispose(): void {
    this.close();
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    DirectMessagePanel.instance = null;
  }
}
