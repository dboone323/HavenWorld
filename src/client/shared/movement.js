// HavenWorld — Movement + animation helpers (browser-compatible ES module)
// Source: src/shared/movement.ts — TypeScript type annotations stripped for browser execution.

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Calculate 4-way isometric facing direction from grid motion vector. */
export function calculateFacing(dx, dy) {
  if (Math.hypot(dx, dy) < 0.01) return null;
  // Isometric projection screen delta:
  const screenDx = dx - dy;
  const screenDy = dx + dy;
  if (Math.abs(screenDx) > Math.abs(screenDy)) {
    return screenDx > 0 ? 'NE' : 'SW';
  } else {
    return screenDy > 0 ? 'SE' : 'NW';
  }
}

/** Compute subtle sinusoidal walking vertical bob in pixels. */
export function getWalkBob(walkCycle = 0, isWalking = false) {
  if (!isWalking) return 0;
  return Math.sin(walkCycle) * 2.5;
}

export function stepToward(player, dt, speed = 3.8) {
  const dx = player.targetX - player.x;
  const dy = player.targetY - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.05) {
    const step = Math.min(dist, speed * dt);
    player.x += (dx / dist) * step;
    player.y += (dy / dist) * step;
    player.isWalking = true;
    player.isSitting = false;
    player.walkCycle = (player.walkCycle || 0) + dt * 10;
    const f = calculateFacing(dx, dy);
    if (f) player.facing = f;
    return { moved: true, snapped: false };
  }
  player.x = player.targetX;
  player.y = player.targetY;
  player.isWalking = false;
  player.walkCycle = 0;
  return { moved: false, snapped: true };
}

export function frameDt(now, lastTime) {
  return Math.min(0.1, (now - lastTime) / 1000);
}

export function fadeAlpha(ageSeconds, lifetime = 6, fadeStart = 5) {
  if (ageSeconds >= lifetime) return -1;
  if (ageSeconds > fadeStart) return Math.max(0, 1 - (ageSeconds - fadeStart));
  return 1;
}
