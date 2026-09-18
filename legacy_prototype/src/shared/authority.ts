/**
 * HavenWorld — Authoritative movement validation + 20Hz tick helpers.
 * Shared, isomorphic: used by src/server (tick) and Node unit tests.
 */
import { stepToward } from './movement.ts';
import type { FacingDirection } from './movement.ts';

export const AUTHORITY_TICK_MS = 50;
export const AUTHORITY_TICK_DT = AUTHORITY_TICK_MS / 1000;
export const PLAYER_SPEED = 3.8;
export const RECONCILE_EPSILON = 0.5;
export const GRID_MAX = 11;

export interface AuthorityPlayer {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isSitting?: boolean;
  facing?: FacingDirection;
  isWalking?: boolean;
  walkCycle?: number;
  lastMoveAt?: number;
}

export interface ValidatedMove {
  ok: boolean;
  reason?: string;
  targetX: number;
  targetY: number;
}

/** Clamp helper (mirrors shared/iso clampGrid). */
export function clampGrid(value: number, size: number = GRID_MAX): number {
  return Math.max(0, Math.min(size, value));
}

/**
 * Validate a client MOVE_REQUEST against server state.
 * Authoritative model: any in-bounds, finite target is ACCEPTED and the
 * server simulates the walk at PLAYER_SPEED in the 20Hz tick. Speed-hack /
 * teleport protection comes from the server sim itself plus RECONCILE_POSITION
 * when client-claimed positions (UPDATE_POSITION) drift beyond epsilon —
 * never by rejecting far click targets (click-to-move must work map-wide).
 */
export function validateMoveRequest(
  p: AuthorityPlayer,
  rawX: unknown,
  rawY: unknown,
  now: number = Date.now(),
  speed: number = PLAYER_SPEED,
): ValidatedMove {
  void now; void speed; void p;
  let nx = typeof rawX === 'number' ? rawX : Number(rawX);
  let ny = typeof rawY === 'number' ? rawY : Number(rawY);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return { ok: false, reason: 'non-finite target', targetX: p.targetX, targetY: p.targetY };
  }
  nx = clampGrid(nx);
  ny = clampGrid(ny);
  return { ok: true, targetX: nx, targetY: ny };
}

/** True when server/client positions have drifted beyond epsilon. */
export function needsReconcile(
  server: { x: number; y: number },
  client: { x: number; y: number },
  epsilon: number = RECONCILE_EPSILON,
): boolean {
  return Math.hypot(server.x - client.x, server.y - client.y) > epsilon;
}

/** Advance one authoritative tick for a set of players; returns ids that moved. */
export function tickPlayers(
  players: Map<string, AuthorityPlayer> | AuthorityPlayer[],
  dt: number = AUTHORITY_TICK_DT,
  speed: number = PLAYER_SPEED,
): string[] {
  const moved: string[] = [];
  const each = (id: string, p: AuthorityPlayer) => {
    const r = stepToward(p, dt, speed);
    if (r.moved) moved.push(id);
  };
  if (Array.isArray(players)) {
    players.forEach((p, i) => each(String(i), p));
  } else {
    for (const [id, p] of players) each(id, p);
  }
  return moved;
}

/** Compact facing <-> int codec for PLAYER_DELTA frames. */
export function facingToInt(f?: FacingDirection): number {
  switch (f) {
    case 'NE': return 0;
    case 'SE': return 1;
    case 'SW': return 2;
    case 'NW': return 3;
    default: return 1;
  }
}

export function intToFacing(n: number): FacingDirection {
  switch (n) {
    case 0: return 'NE';
    case 1: return 'SE';
    case 2: return 'SW';
    case 3: return 'NW';
    default: return 'SE';
  }
}

export type PlayerDelta = [id: string, x: number, y: number, facing: number, stateMask: number];

/** stateMask bit 0 = isSitting, bit 1 = isWalking. */
export function encodePlayerDelta(
  id: string,
  p: { x: number; y: number; facing?: FacingDirection; isSitting?: boolean; isWalking?: boolean },
): PlayerDelta {
  const mask = (p.isSitting ? 1 : 0) | (p.isWalking ? 2 : 0);
  return [id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, facingToInt(p.facing), mask];
}

export function decodePlayerDelta(d: PlayerDelta): {
  id: string; x: number; y: number; facing: FacingDirection; isSitting: boolean; isWalking: boolean;
} {
  return {
    id: d[0], x: d[1], y: d[2], facing: intToFacing(d[3]),
    isSitting: (d[4] & 1) !== 0, isWalking: (d[4] & 2) !== 0,
  };
}
