/**
 * HavenWorld — Domestic Pet AI & Behavioral State Machine
 *
 * Simulates autonomous loft companions (cats, dogs, baby dragons).
 * Implements an expressive state machine: idle, wander, follow, sleep, react.
 */

export type PetState = 'idle' | 'wander' | 'follow' | 'sleep' | 'react';

export interface PetEntity {
  id: string;
  ownerId: string;
  roomId: string;
  type: 'pet_cat' | 'pet_dog' | 'pet_dragon' | string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: PetState;
  facing: 'NE' | 'SE' | 'SW' | 'NW';
  timeInStateMs: number;
  reactionEmote?: string;
  reactionTimerMs?: number;
}

export function createPet(
  id: string,
  ownerId: string,
  roomId: string,
  type: string,
  name: string,
  x: number = 3,
  y: number = 3
): PetEntity {
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

/**
 * Determine cardinal facing direction from current to target coordinates.
 */
export function getPetFacing(fromX: number, fromY: number, toX: number, toY: number): 'NE' | 'SE' | 'SW' | 'NW' {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'SE' : 'NW';
  }
  return dy >= 0 ? 'SW' : 'NE';
}

/**
 * Compute the Euclidean distance between two points.
 */
export function getDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Advances pet state machine.
 */
export function advancePetAI(
  pet: PetEntity,
  deltaMs: number,
  ownerPos?: { x: number; y: number } | null,
  gridWidth: number = 10,
  gridHeight: number = 10,
  isBlocked?: (x: number, y: number) => boolean
): PetEntity {
  const updated: PetEntity = { ...pet, timeInStateMs: pet.timeInStateMs + deltaMs };

  // Handle reaction emote timeout
  if (updated.reactionTimerMs && updated.reactionTimerMs > 0) {
    updated.reactionTimerMs = Math.max(0, updated.reactionTimerMs - deltaMs);
    if (updated.reactionTimerMs === 0) {
      updated.reactionEmote = '';
      updated.state = 'idle';
      updated.timeInStateMs = 0;
    }
  }

  // Follow owner if owner is far away (> 4 tiles)
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

  // Behavior based on state
  switch (updated.state) {
    case 'idle': {
      // Idle for 4-8 seconds before wandering or sleeping
      if (updated.timeInStateMs > 4000) {
        const roll = Math.random();
        if (roll < 0.6) {
          // Wander to a nearby tile within 3 units
          const candidates: [number, number][] = [];
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
          // Nap / sleep for a while
          updated.state = 'sleep';
          updated.timeInStateMs = 0;
        } else {
          // Reset idle timer
          updated.timeInStateMs = 0;
        }
      }
      break;
    }

    case 'wander': {
      // Move towards targetX, targetY at gentle walking speed (1.5 tiles/sec)
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
        // Move towards owner (stopping within 1.5 tiles)
        const dx = ownerPos.x - updated.x;
        const dy = ownerPos.y - updated.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1.5) {
          const speed = 0.0025 * deltaMs; // faster trot
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
      // Sleep for 10-15 seconds
      if (updated.timeInStateMs > 10000) {
        updated.state = 'idle';
        updated.timeInStateMs = 0;
      }
      break;
    }

    case 'react': {
      // Freezes in place while displaying reaction emote
      break;
    }
  }

  return updated;
}

/**
 * Trigger an interactive reaction on the pet (e.g. hearts when petted).
 */
export function petInteract(pet: PetEntity, interactionType: 'pet' | 'feed' | 'play'): PetEntity {
  const emoteMap = {
    pet: '❤️',
    feed: '🍖',
    play: '✨',
  };
  return {
    ...pet,
    state: 'react',
    reactionEmote: emoteMap[interactionType] || '❤️',
    reactionTimerMs: 3000,
    timeInStateMs: 0,
  };
}
