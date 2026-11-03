/** Prototype-only helpers for the Phase 0 chibi remote avatar prototype.
 *  Gate is the URL query param `chibiRemote=1` (or `chibiRemote=true`).
 *  Default OFF — when off, remote avatars keep their existing placeholder path. */
export function isChibiRemoteEnabled(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('chibiRemote');
    return v === '1' || v === 'true' || v === 'on';
  } catch {
    return false;
  }
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
