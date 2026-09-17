/**
 * HavenWorld — Domestic Pet AI & Behavioral State Machine (Client ESM)
 */

export function createPet(id, ownerId, roomId, type, name, x = 3, y = 3) {
  return {
    id,
    ownerId,
    roomId,
    type,
    name,
    x,
    y,
    targetX: x,
    targetY: y,
    state: 'idle',
    facing: 'SE',
    timeInStateMs: 0,
    reactionEmote: '',
    reactionTimerMs: 0,
  };
}

export function getPetFacing(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'SE' : 'NW';
  }
  return dy >= 0 ? 'SW' : 'NE';
}

export function getDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function advancePetAI(pet, deltaMs, ownerPos = null, gridWidth = 10, gridHeight = 10, isBlocked = null) {
  const updated = { ...pet, timeInStateMs: pet.timeInStateMs + deltaMs };

  if (updated.reactionTimerMs && updated.reactionTimerMs > 0) {
    updated.reactionTimerMs = Math.max(0, updated.reactionTimerMs - deltaMs);
    if (updated.reactionTimerMs === 0) {
      updated.reactionEmote = '';
      updated.state = 'idle';
      updated.timeInStateMs = 0;
    }
  }

  if (ownerPos && updated.state !== 'react') {
    const distToOwner = getDistance(updated.x, updated.y, ownerPos.x, ownerPos.y);
    if (distToOwner > 4.5 && updated.state !== 'follow') {
      updated.state = 'follow';
      updated.timeInStateMs = 0;
    } else if (distToOwner < 2.0 && updated.state === 'follow') {
      updated.state = 'idle';
      updated.timeInStateMs = 0;
    }
  }

  switch (updated.state) {
    case 'idle': {
      if (updated.timeInStateMs > 4000) {
        const roll = Math.random();
        if (roll < 0.6) {
          const candidates = [];
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
              if (dx === 0 && dy === 0) continue;
              const tx = Math.round(updated.x + dx);
              const ty = Math.round(updated.y + dy);
              if (tx >= 1 && tx < gridWidth - 1 && ty >= 1 && ty < gridHeight - 1) {
                if (!isBlocked || !isBlocked(tx, ty)) {
                  candidates.push([tx, ty]);
                }
              }
            }
          }
          if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            updated.targetX = pick[0];
            updated.targetY = pick[1];
            updated.facing = getPetFacing(updated.x, updated.y, updated.targetX, updated.targetY);
            updated.state = 'wander';
            updated.timeInStateMs = 0;
          }
        } else if (roll < 0.85) {
          updated.state = 'sleep';
          updated.timeInStateMs = 0;
        } else {
          updated.timeInStateMs = 0;
        }
      }
      break;
    }

    case 'wander': {
      const speed = 0.0015 * deltaMs;
      const dx = updated.targetX - updated.x;
      const dy = updated.targetY - updated.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= speed || dist < 0.05) {
        updated.x = updated.targetX;
        updated.y = updated.targetY;
        updated.state = 'idle';
        updated.timeInStateMs = 0;
      } else {
        updated.x += (dx / dist) * speed;
        updated.y += (dy / dist) * speed;
      }
      break;
    }

    case 'follow': {
      if (ownerPos) {
        const dx = ownerPos.x - updated.x;
        const dy = ownerPos.y - updated.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1.5) {
          const speed = 0.0025 * deltaMs;
          updated.facing = getPetFacing(updated.x, updated.y, ownerPos.x, ownerPos.y);
          updated.x += (dx / dist) * speed;
          updated.y += (dy / dist) * speed;
        } else {
          updated.state = 'idle';
          updated.timeInStateMs = 0;
        }
      } else {
        updated.state = 'idle';
      }
      break;
    }

    case 'sleep': {
      if (updated.timeInStateMs > 10000) {
        updated.state = 'idle';
        updated.timeInStateMs = 0;
      }
      break;
    }
  }

  return updated;
}

export function petInteract(pet, interactionType) {
  const emoteMap = { pet: '❤️', feed: '🍖', play: '✨' };
  return {
    ...pet,
    state: 'react',
    reactionEmote: emoteMap[interactionType] || '❤️',
    reactionTimerMs: 3000,
    timeInStateMs: 0,
  };
}
