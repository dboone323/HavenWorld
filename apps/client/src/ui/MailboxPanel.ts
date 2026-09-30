import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { escapeHtml } from '../utils/escapeHtml';

interface Parcel {
  id: string;
  senderId: string;
  recipientId: string;
  itemId: string;
  message: string;
  deliverAt: number;
  delivered: boolean;
}

interface Inbox {
  incoming: Parcel[];
  outgoing: Parcel[];
  received: Parcel[];
}

function parcelRow(p: Parcel, label: string, extra = ''): string {
  const eta = Math.max(0, p.deliverAt - Date.now());
  const mins = Math.ceil(eta / 60_000);
  return `
    <div style="padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-size:13px">
      <div style="display:flex;justify-content:space-between">
        <strong>${label} ${escapeHtml(p.itemId)}</strong>
        <span style="opacity:0.7">${extra}</span>
      </div>
      ${p.message ? `<p style="margin:4px 0 0;font-style:italic;opacity:0.85">"${escapeHtml(p.message)}"</p>` : ''}
      ${p.delivered ? '' : `<p style="margin:4px 0 0;color:#f0ad4e">Arriving in ~${mins} min</p>`}
    </div>`;
}

/**
 * Mailbox widget (roadmap §3q) for delayed parcels. Arrivals still push
 * PARCEL_ARRIVED toasts; this is the full inbox view (in-transit, sent,
 * recently delivered) over PARCEL_LIST → PARCEL_INBOX.
 */
export class MailboxPanel {
  private static overlay: HTMLElement | null = null;
  private static unsub: (() => void) | null = null;

  static show(): void {
    this.dismiss();

    const overlay = document.createElement('div');
    overlay.id = 'mailbox-panel-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#1b1b36; border:1px solid rgba(255,255,255,0.18); border-radius:16px;
      color:#fff; width:min(520px, calc(100vw - 32px)); max-height:84vh; overflow-y:auto;
      padding:22px; box-shadow:0 12px 48px rgba(0,0,0,0.6);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0;font-size:18px">📬 Parcel Mailbox</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="mailbox-body"><p style="opacity:0.7;font-size:13px">Checking the post office…</p></div>`;
    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());

    this.unsub = socketService.on<Inbox>(SOCKET_EVENTS.PARCEL_INBOX, (inbox) => {
      if (!this.overlay) return;
      const body = panel.querySelector('#mailbox-body');
      if (!body) return;
      const empty = inbox.incoming.length === 0 && inbox.outgoing.length === 0 && inbox.received.length === 0;
      body.innerHTML = empty
        ? '<p style="opacity:0.7;font-size:13px">Your mailbox is empty. Friends can send you time-released parcels!</p>'
        : [
            inbox.incoming.length ? '<h3 style="font-size:13px;margin:8px 0 6px;opacity:0.85">🚚 In transit to you</h3>' : '',
            ...inbox.incoming.map((p) => parcelRow(p, '📦 Incoming from', p.senderId.slice(0, 6))),
            inbox.outgoing.length ? '<h3 style="font-size:13px;margin:12px 0 6px;opacity:0.85">📤 You mailed</h3>' : '',
            ...inbox.outgoing.map((p) => parcelRow(p, '📮 To', p.recipientId.slice(0, 6))),
            inbox.received.length ? '<h3 style="font-size:13px;margin:12px 0 6px;opacity:0.85">✅ Delivered</h3>' : '',
            ...inbox.received.map((p) => parcelRow(p, '🎁 Received from', p.senderId.slice(0, 6))),
          ].join('');
    });

    socketService.emit(SOCKET_EVENTS.PARCEL_LIST, {});
  }

  static dismiss(): void {
    this.unsub?.();
    this.unsub = null;
    this.overlay?.remove();
    this.overlay = null;
  }
}
