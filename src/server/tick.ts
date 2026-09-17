/**
 * HavenWorld — Authoritative 20Hz tick loop (server-side).
 * Advances all players with shared stepToward(), emits compact PLAYER_DELTA
 * frames for dirty players only, and sends RECONCILE_POSITION when a client
 * drifts beyond epsilon (> 0.5 tiles).
 *
 * NOTE: Node 22 strip-only TS mode — no parameter properties, no `private`
 * field modifiers. Plain class fields only.
 */
import { stepToward } from '../shared/movement.ts';
import {
  AUTHORITY_TICK_DT,
  AUTHORITY_TICK_MS,
  PLAYER_SPEED,
  RECONCILE_EPSILON,
  encodePlayerDelta,
} from '../shared/authority.ts';

export { AUTHORITY_TICK_MS, AUTHORITY_TICK_DT, PLAYER_SPEED, RECONCILE_EPSILON };

export interface TickStats {
  tick: number;
  moved: number;
  deltasSent: number;
  reconcilesSent: number;
  bytesOut: number;
}

export interface TickOptions {
  intervalMs?: number;
  dt?: number;
  speed?: number;
  epsilon?: number;
  /** When false, no WebSocket writes occur (pure simulation for tests). */
  broadcast?: boolean;
}

export class AuthorityTicker {
  timer: ReturnType<typeof setInterval> | null = null;
  tickCount = 0;
  bytesOut = 0;
  deltasSent = 0;
  reconcilesSent = 0;
  rooms: import('./rooms.ts').RoomManager;
  opts: TickOptions;

  constructor(rooms: import('./rooms.ts').RoomManager, opts: TickOptions = {}) {
    this.rooms = rooms;
    this.opts = opts;
  }

  get intervalMs(): number { return this.opts.intervalMs ?? AUTHORITY_TICK_MS; }
  get dt(): number { return this.opts.dt ?? AUTHORITY_TICK_DT; }
  get speed(): number { return this.opts.speed ?? PLAYER_SPEED; }
  get epsilon(): number { return this.opts.epsilon ?? RECONCILE_EPSILON; }
  get shouldBroadcast(): boolean { return this.opts.broadcast ?? true; }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tickOnce(); }, this.intervalMs);
    const t = this.timer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean { return this.timer !== null; }

  /** Advance one tick across every room; returns per-tick stats. */
  tickOnce(): TickStats {
    this.tickCount += 1;
    let moved = 0;
    let deltasSent = 0;
    const reconcilesSent = 0;
    let bytesOut = 0;

    for (const roomId of this.rooms.list()) {
      const room = this.rooms.get(roomId);
      if (!room || room.players.size === 0) continue;
      const deltas: ReturnType<typeof encodePlayerDelta>[] = [];

      for (const p of room.players.values()) {
        const r = stepToward(p, this.dt, this.speed);
        if (r.moved) moved += 1;
        const dirty =
          r.moved ||
          p.lastTickX === undefined ||
          Math.hypot(p.x - (p.lastTickX ?? p.x), p.y - (p.lastTickY ?? p.y)) > 1e-9;
        p.lastTickX = p.x;
        p.lastTickY = p.y;
        if (dirty) {
          deltas.push(encodePlayerDelta(p.id, p));
        }
      }

      if (deltas.length > 0 && this.shouldBroadcast) {
        const msg = { type: 'PLAYER_DELTA', payload: { deltas, tick: this.tickCount } };
        const data = JSON.stringify(msg);
        bytesOut += data.length * room.players.size;
        deltasSent += deltas.length;
        this.rooms.broadcast(roomId, msg);
      } else if (deltas.length > 0) {
        deltasSent += deltas.length;
      }
    }

    this.bytesOut += bytesOut;
    this.deltasSent += deltasSent;
    return { tick: this.tickCount, moved, deltasSent, reconcilesSent, bytesOut };
  }

  /** Send a targeted reconcile correction to one player. */
  reconcile(player: import('./rooms.ts').Player): void {
    if (!this.shouldBroadcast) return;
    this.rooms.send(player.ws, {
      type: 'RECONCILE_POSITION',
      payload: { x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY },
    });
    this.reconcilesSent += 1;
  }
}

export default { AuthorityTicker };
