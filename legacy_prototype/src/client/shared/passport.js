/**
 * HavenWorld — Haven Passport & Achievement Stamp System.
 * Pure logic module, unit-testable in Node without DOM or browser dependencies.
 */

export const PASSPORT_STAMPS = {
  first_step: {
    id: 'first_step',
    title: 'First Step',
    icon: '👣',
    description: 'Take your first step into HavenWorld.',
    category: 'exploration'
  },
  cozy_rest: {
    id: 'cozy_rest',
    title: 'Cozy Rest',
    icon: '🛋️',
    description: 'Take a seat on a sofa or bench.',
    category: 'lifestyle'
  },
  light_switch: {
    id: 'light_switch',
    title: 'Let There Be Light',
    icon: '💡',
    description: 'Toggle a neon sign, TV, or lamp.',
    category: 'lifestyle'
  },
  pizza_artisan: {
    id: 'pizza_artisan',
    title: 'Pizza Artisan',
    icon: '🍕',
    description: 'Score 100 or more HavenCoins in the Pizza Kitchen.',
    category: 'activities'
  },
  friendly_spirit: {
    id: 'friendly_spirit',
    title: 'Friendly Spirit',
    icon: '🫂',
    description: 'Share a hug, wave, or send a friend request.',
    category: 'social'
  },
  sanctuary_builder: {
    id: 'sanctuary_builder',
    title: 'Sanctuary Decorator',
    icon: '🛠️',
    description: 'Place or customize furniture in your personal loft.',
    category: 'creativity'
  },
  world_traveler: {
    id: 'world_traveler',
    title: 'World Traveler',
    icon: '🧭',
    description: 'Visit at least 2 distinct rooms in the world.',
    category: 'exploration'
  },
  master_angler: {
    id: 'master_angler',
    title: 'Master Angler',
    icon: '🎣',
    description: 'Catch your first fish in the Plaza Fountain.',
    category: 'activities'
  }
};

/**
 * Creates a fresh default passport state.
 */
export function createDefaultPassport(playerId = 'guest', playerName = 'Traveler') {
  return {
    playerId,
    playerName,
    joinedAt: Date.now(),
    visitedRooms: ['plaza'],
    unlockedStamps: {}, // { [stampId]: timestamp }
    stats: {
      stepsTaken: 0,
      pizzasBaked: 0,
      furniPlaced: 0,
      emotesSent: 0
    }
  };
}

/**
 * Record an in-game action and evaluate if new stamps are unlocked.
 * Returns array of newly unlocked stamp objects.
 */
export function recordPassportAction(passport, actionType, metadata = {}) {
  if (!passport || !passport.unlockedStamps) return [];
  const newlyUnlocked = [];

  function unlock(stampId) {
    if (!passport.unlockedStamps[stampId] && PASSPORT_STAMPS[stampId]) {
      passport.unlockedStamps[stampId] = Date.now();
      newlyUnlocked.push(PASSPORT_STAMPS[stampId]);
    }
  }

  switch (actionType) {
    case 'STEP': {
      passport.stats.stepsTaken = (passport.stats.stepsTaken || 0) + 1;
      if (passport.stats.stepsTaken >= 1) {
        unlock('first_step');
      }
      break;
    }

    case 'SIT': {
      unlock('cozy_rest');
      break;
    }

    case 'TOGGLE_LIGHT': {
      unlock('light_switch');
      break;
    }

    case 'MINIGAME_SCORE': {
      const score = metadata.score || 0;
      if (score >= 100) {
        unlock('pizza_artisan');
      }
      break;
    }

    case 'EMOTE':
    case 'FRIEND_ACTION': {
      passport.stats.emotesSent = (passport.stats.emotesSent || 0) + 1;
      unlock('friendly_spirit');
      break;
    }

    case 'PLACE_FURNITURE':
    case 'UPDATE_STYLE': {
      passport.stats.furniPlaced = (passport.stats.furniPlaced || 0) + 1;
      unlock('sanctuary_builder');
      break;
    }

    case 'ENTER_ROOM': {
      const roomId = metadata.roomId;
      if (roomId && !passport.visitedRooms.includes(roomId)) {
        passport.visitedRooms.push(roomId);
      }
      if (passport.visitedRooms.length >= 2) {
        unlock('world_traveler');
      }
      break;
    }

    case 'CATCH_FISH': {
      passport.stats.fishCaught = (passport.stats.fishCaught || 0) + 1;
      unlock('master_angler');
      break;
    }

    default:
      break;
  }

  return newlyUnlocked;
}

/**
 * Calculate completion percentage and stamp count.
 */
export function getPassportProgress(passport) {
  const totalStamps = Object.keys(PASSPORT_STAMPS).length;
  const unlockedCount = Object.keys(passport?.unlockedStamps || {}).length;
  const percent = totalStamps > 0 ? Math.round((unlockedCount / totalStamps) * 100) : 0;
  return {
    unlockedCount,
    totalStamps,
    percent
  };
}
