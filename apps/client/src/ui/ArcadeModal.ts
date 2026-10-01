import { socketService } from '../services/socket';
import { SOCKET_EVENTS, ARCADE_CABINET_ID } from '@havenworld/shared';
import { escapeHtml } from '../utils/escapeHtml';
import { showToast } from './ToastNotification';

interface ArcadeMatch {
  id: string;
  cabinetId: string;
  player1Id: string;
  player2Id: string;
  currentTurn: string;
  board: number[][];
  status: 'IN_PROGRESS' | 'FINISHED';
  winnerId: string | null;
  isDraw: boolean;
}

/** Payout broadcast the server emits once a match is settled (§6.3). */
interface ArcadeResult {
  matchId: string;
  winnerId: string | null;
  isDraw: boolean;
  coinsAwarded: number;
  weeklyRemaining: number;
}

interface RoomPlayer {
  userId: string;
  username: string;
}

/**
 * Connect-4 arcade cabinet (roadmap §3i).
 * Server is authoritative for turn order, gravity, and win detection —
 * the client renders ARCADE_STATE broadcasts and submits column drops.
 */
export class ArcadeModal {
  private static overlay: HTMLElement | null = null;
  private static unsubs: Array<() => void> = [];
  private static match: ArcadeMatch | null = null;
  private static lastResult: ArcadeResult | null = null;

  static show(opts: { selfId: string; selfName: string; players: RoomPlayer[] }): void {
    this.dismiss();
    this.match = null;
    this.lastResult = null;

    const overlay = document.createElement('div');
    overlay.id = 'arcade-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background:#12122b; border:1px solid rgba(255,255,255,0.18); border-radius:16px;
      color:#fff; padding:22px; width:400px; max-height:88vh; overflow-y:auto;
      box-shadow:0 12px 48px rgba(0,0,0,0.65);
    `;
    overlay.appendChild(panel);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) this.dismiss(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;

    this.unsubs.push(
      socketService.on<ArcadeMatch>(SOCKET_EVENTS.ARCADE_STATE, (match) => {
        const isPlayer = this.isParticipant(match, opts.selfId);
        const wasFinished = this.match?.status === 'FINISHED';
        this.match = match;
        if (!isPlayer) {
          // Roommate watching a cabinet in progress — read-only view (§6.3).
          if (this.overlay) this.render(panel, opts);
          return;
        }
        if (!wasFinished && match.status === 'FINISHED') {
          showToast({
            icon: match.winnerId === opts.selfId ? '🏆' : match.isDraw ? '🤝' : '💀',
            title: match.isDraw ? 'Connect-4: Draw!' : match.winnerId === opts.selfId ? 'You win!' : 'You lose!',
          });
        }
        if (this.overlay) this.render(panel, opts);
      }),
      socketService.on<ArcadeResult>(SOCKET_EVENTS.ARCADE_RESULT, (result) => {
        this.lastResult = result;
        if (result.winnerId === opts.selfId && result.coinsAwarded > 0) {
          showToast({
            icon: '🪙',
            title: `+${result.coinsAwarded} HavenCoins`,
            subtitle: `Arcade win — ${result.weeklyRemaining} left in this week's arcade budget`,
          });
        } else if (result.winnerId === opts.selfId && !result.isDraw && result.coinsAwarded === 0) {
          showToast({
            icon: '🪙',
            title: 'Arcade budget used up',
            subtitle: "You've reached this week's Connect-4 earnings limit",
          });
        }
        if (this.overlay) this.render(panel, opts);
      }),
      socketService.on<{ code: string; message?: string }>(SOCKET_EVENTS.ERROR, (err) => {
        if (err.code === 'OPPONENT_NOT_IN_ROOM' || err.code === 'ARCADE_ERROR') {
          showToast({ icon: '⚠️', title: 'Arcade', subtitle: err.message ?? 'Match failed' });
        }
      })
    );

    this.render(panel, opts);
  }

  private static render(panel: HTMLElement, opts: { selfId: string; selfName: string; players: RoomPlayer[] }): void {
    const match = this.match;
    const isPlayer = match ? this.isParticipant(match, opts.selfId) : false;

    // A roommate who isn't one of the two players watches the live cabinet read-only.
    if (match && !isPlayer) {
      this.renderBoard(panel, match, opts, true);
      return;
    }

    if (!match) {
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h2 style="margin:0;font-size:17px">🕹️ Connect-4 Cabinet</h2>
          <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
        </div>
        <p style="font-size:13px;opacity:0.75;margin:0 0 12px">Pick an opponent who's standing in the same room:</p>
        ${opts.players.length === 0
          ? '<p style="font-size:13px;opacity:0.6">Nobody else is here to play. Invite someone to the plaza!</p>'
          : opts.players.map((p) => `
              <button data-opponent="${escapeHtml(p.userId)}" data-opponent-name="${escapeHtml(p.username)}" style="
                display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 12px;
                border-radius:10px;cursor:pointer;font-family:inherit;font-size:14px;color:#fff;
                background:rgba(78,205,196,0.12);border:1px solid rgba(78,205,196,0.45);
              ">🎮 vs ${escapeHtml(p.username)}</button>`).join('')}
      `;
      panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
      panel.querySelectorAll<HTMLElement>('[data-opponent]').forEach((btn) => {
        btn.addEventListener('click', () => {
          socketService.emit(SOCKET_EVENTS.ARCADE_START, {
            opponentId: btn.dataset.opponent,
            cabinetId: ARCADE_CABINET_ID,
          });
          showToast({ icon: '🕹️', title: 'Challenge sent', subtitle: `${btn.dataset.opponentName} — drop to begin!` });
        });
      });
      return;
    }

    this.renderBoard(panel, match, opts, false);
  }

  /**
   * Draws the Connect-4 board. Participants get clickable columns on their turn;
   * spectators get the identical board with controls disabled.
   */
  private static renderBoard(
    panel: HTMLElement,
    match: ArcadeMatch,
    opts: { selfId: string; selfName: string; players: RoomPlayer[] },
    spectating: boolean
  ): void {
    const myTurn = !spectating && match.status === 'IN_PROGRESS' && match.currentTurn === opts.selfId;
    const nameFor = (id: string) =>
      id === opts.selfId ? opts.selfName : (opts.players.find((p) => p.userId === id)?.username ?? 'Opponent');

    const grid = match.board.map((row, r) => `
      <div style="display:flex;gap:4px;margin-bottom:4px">
        ${row.map((cell, c) => `
          <div data-col="${c}" style="
            width:44px;height:40px;border-radius:50%;
            background:${cell === 0 ? 'rgba(255,255,255,0.07)' : cell === 1 ? '#ff6b6b' : '#4ecdc4'};
            border:1px solid rgba(255,255,255,0.16);
            cursor:${cell === 0 && myTurn ? 'pointer' : 'default'};
          "></div>`).join('')}
      </div>`).join('');

    const status = match.status === 'FINISHED'
      ? (match.isDraw ? '🤝 Draw!' : match.winnerId === opts.selfId ? '🏆 You won!' : `😅 ${escapeHtml(nameFor(match.winnerId ?? ''))} won`)
      : spectating ? `👀 Spectating — waiting for ${escapeHtml(nameFor(match.currentTurn))}…`
      : myTurn ? '🟢 Your turn — click a disc slot' : `⏳ Waiting for ${escapeHtml(nameFor(match.currentTurn))}…`;

    const won = this.lastResult && this.lastResult.matchId === match.id
      && this.lastResult.winnerId === opts.selfId && this.lastResult.coinsAwarded > 0;
    const payout = won
      ? `<p style="font-size:13px;margin:8px 0 0;color:#ffd166">🪙 +${this.lastResult!.coinsAwarded} HavenCoins earned · ${this.lastResult!.weeklyRemaining} left in this week's arcade budget</p>`
      : '';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="margin:0;font-size:17px">${spectating ? '👀 ' : '🕹️ '}${escapeHtml(nameFor(match.player1Id))} <span style="color:#ff6b6b">●</span> vs <span style="color:#4ecdc4">●</span> ${escapeHtml(nameFor(match.player2Id))}</h2>
        <button data-action="close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="background:rgba(30,30,80,0.8);padding:8px;border-radius:12px;display:inline-block">${grid}</div>
      <p style="font-size:13px;margin:12px 0 0">${status}</p>
      ${payout}
    `;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.dismiss());
    if (myTurn) {
      panel.querySelectorAll<HTMLElement>('[data-col]').forEach((cell) => {
        cell.addEventListener('click', () => {
          socketService.emit(SOCKET_EVENTS.ARCADE_MOVE, {
            matchId: match.id,
            col: Number(cell.dataset.col),
          });
        });
      });
    }
  }

  private static isParticipant(match: ArcadeMatch, userId: string): boolean {
    return match.player1Id === userId || match.player2Id === userId;
  }

  static dismiss(): void {
    this.unsubs.forEach((off) => off());
    this.unsubs = [];
    this.match = null;
    this.lastResult = null;
    this.overlay?.remove();
    this.overlay = null;
  }
}
