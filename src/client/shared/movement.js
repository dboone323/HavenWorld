// HavenWorld — Movement + animation helpers (browser-compatible ES module)
// Source: src/shared/movement.ts — TypeScript type annotations stripped for browser execution.

export function lerp(a, b, t) {
  return a + (b - a) * t;
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
    player.walkCycle = (player.walkCycle || 0) + dt * 10;
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
