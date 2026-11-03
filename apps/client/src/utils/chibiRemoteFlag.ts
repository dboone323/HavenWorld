/** Prototype-only helpers for the Phase 0 chibi remote avatar prototype.
 *  Chibi is the DEFAULT for remote avatars (restores pre-PR-#12 production
 *  behavior). The `chibiRemote` flag is now an opt-out kill switch:
 *  `?chibiRemote=0` (or a stored localStorage value of '0') disables it. */
export function isChibiRemoteEnabled(
  search?: string,
  storage?: Storage | null,
): boolean {
  const OPT_IN = new Set(['1', 'true', 'on', 'yes']);
  const OPT_OUT = new Set(['0', 'false', 'off', 'no']);

  let queryValue: string | null = null;
  try {
    if (search !== undefined) {
      queryValue = new URLSearchParams(search).get('chibiRemote');
    } else if (typeof window !== 'undefined' && window.location) {
      queryValue = new URLSearchParams(window.location.search).get('chibiRemote');
    }
  } catch {
    queryValue = null;
  }

  let storageValue: string | null = null;
  try {
    if (storage !== null) {
      const s =
        storage === undefined
          ? typeof localStorage !== 'undefined'
            ? localStorage
            : null
          : storage;
      storageValue = s ? s.getItem('chibiRemote') : null;
    }
  } catch {
    storageValue = null;
  }

  const effective = queryValue !== null ? queryValue : storageValue;
  if (effective === null) return true; // default on
  const v = effective.trim().toLowerCase();
  if (OPT_OUT.has(v)) return false;
  if (OPT_IN.has(v)) return true;
  // Unknown value: keep the default-on behavior (not an explicit opt-out).
  return true;
}

export type ChibiDirection = 'down' | 'up' | 'left' | 'right';

export interface RemoteChibiSelection {
  isMoving: boolean;
  direction: ChibiDirection;
}

/**
 * Pure mapping from the movement delta RemoteAvatar already computes each frame
 * to a chibi action/direction selection. Direction only updates when the
 * horizontal/vertical dominance crosses the hysteresis band; otherwise the
 * previous direction is retained to avoid diagonal jitter.
 */
export function selectRemoteChibiAction(
  prevDirection: ChibiDirection,
  dx: number,
  dz: number,
  dist: number,
  threshold: number = 0.05,
  hysteresis: number = 0.2,
): RemoteChibiSelection {
  if (dist <= threshold) {
    return { isMoving: false, direction: prevDirection };
  }
  const absX = Math.abs(dx);
  const absZ = Math.abs(dz);
  const diff = absX - absZ;
  let direction: ChibiDirection = prevDirection;
  if (diff > hysteresis) {
    direction = dx > 0 ? 'right' : 'left';
  } else if (diff < -hysteresis) {
    direction = dz > 0 ? 'up' : 'down';
  }
  return { isMoving: true, direction };
}
