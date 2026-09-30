import { socketService } from '../services/socket';
import { SOCKET_EVENTS, NPC_PLACEMENTS } from '@havenworld/shared';
import { escapeHtml } from '../utils/escapeHtml';

interface DialogueChoice {
  text: string;
  nextNodeId?: string;
  action?: string;
}

interface DialogueNode {
  id: string;
  npcId: string;
  speaker: string;
  text: string;
  choices: DialogueChoice[];
}

interface DialoguePayload {
  node: DialogueNode | null;
  action?: string;
}

/**
 * NPC dialogue panel (roadmap §3g). All navigation is server-authoritative:
 * every choice re-queries the server via NPC_TALK, and the reply arrives on
 * NPC_DIALOGUE — the client never walks the tree locally.
 */
export class NpcDialoguePanel {
  private static overlay: HTMLElement | null = null;
  private static unsub: (() => void) | null = null;
  private static npcId = '';
  private static currentNodeId = 'start';

  static open(npcId: string): void {
    this.dismiss();

    const placement = NPC_PLACEMENTS.find((n) => n.id === npcId);
    this.npcId = npcId;
    this.currentNodeId = 'start';

    const overlay = document.createElement('div');
    overlay.id = 'npc-dialogue-overlay';
    overlay.style.cssText = `
      position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
      z-index: 10001; font-family: inherit; width: min(560px, calc(100vw - 32px));
    `;

    overlay.innerHTML = `
      <div style="
        background:#1b1b36; border:1px solid rgba(255,255,255,0.2); border-radius:14px;
        color:#fff; padding:18px 20px; box-shadow:0 10px 40px rgba(0,0,0,0.6);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong id="npc-speaker" style="font-size:15px">${escapeHtml(placement?.name ?? 'Townsperson')}</strong>
          <button data-action="close" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer">✕</button>
        </div>
        <p id="npc-text" style="margin:0 0 12px;font-size:14px;line-height:1.5;opacity:0.92">…</p>
        <div id="npc-choices" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>
    `;

    overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    document.body.appendChild(overlay);
    this.overlay = overlay;

    this.unsub = socketService.on<DialoguePayload>(SOCKET_EVENTS.NPC_DIALOGUE, (payload) => {
      this.renderNode(payload);
    });

    socketService.emit(SOCKET_EVENTS.NPC_TALK, { npcId, nodeId: 'start' });
  }

  private static renderNode(payload: DialoguePayload): void {
    if (!this.overlay) return;
    const textEl = this.overlay.querySelector('#npc-text');
    const choicesEl = this.overlay.querySelector('#npc-choices');
    if (!textEl || !choicesEl) return;

    if (!payload.node) {
      textEl.textContent = '…and with that, the conversation winds down.';
      choicesEl.innerHTML = '';
      window.setTimeout(() => this.dismiss(), 1400);
      return;
    }

    this.currentNodeId = payload.node.id;
    textEl.textContent = payload.node.text;
    choicesEl.innerHTML = '';

    payload.node.choices.forEach((choice, index) => {
      const btn = document.createElement('button');
      btn.textContent = choice.text;
      btn.style.cssText = `
        text-align:left; padding:9px 12px; border-radius:9px; cursor:pointer;
        background:rgba(78,205,196,0.12); border:1px solid rgba(78,205,196,0.45);
        color:#fff; font-size:13px; font-family:inherit;
      `;
      btn.addEventListener('click', () => {
        socketService.emit(SOCKET_EVENTS.NPC_TALK, {
          npcId: this.npcId,
          nodeId: this.currentNodeId,
          choiceIndex: index,
        });
      });
      choicesEl.appendChild(btn);
    });
  }

  static dismiss(): void {
    this.unsub?.();
    this.unsub = null;
    this.overlay?.remove();
    this.overlay = null;
  }
}
