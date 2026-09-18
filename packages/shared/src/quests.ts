export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  goal: number;
  rewardCoins: number;
  rewardGems: number;
  actionType:
    | 'CATCH_FISH'
    | 'VISIT_ROOMS'
    | 'SIGN_GUESTBOOK'
    | 'PIZZA_PERFECT'
    | 'P2P_TRADE'
    | 'PLAY_MINUTES'
    | 'CRAFT_ITEM'
    | 'FEED_PET'
    | 'TIP_PLAYER'
    | 'CHANGE_MOOD';
}

export const QUEST_POOL: QuestTemplate[] = [
  // Easy Quests
  {
    id: 'quest_fish_easy',
    title: 'Pond Fisher',
    description: 'Catch 5 fish at Haven Park water spot.',
    difficulty: 'EASY',
    goal: 5,
    rewardCoins: 40,
    rewardGems: 0,
    actionType: 'CATCH_FISH',
  },
  {
    id: 'quest_visit_easy',
    title: 'Sightseer',
    description: 'Visit 5 different rooms or community lofts.',
    difficulty: 'EASY',
    goal: 5,
    rewardCoins: 30,
    rewardGems: 0,
    actionType: 'VISIT_ROOMS',
  },
  {
    id: 'quest_guestbook_easy',
    title: 'Friendly Signature',
    description: 'Sign 3 different loft guestbooks.',
    difficulty: 'EASY',
    goal: 3,
    rewardCoins: 35,
    rewardGems: 0,
    actionType: 'SIGN_GUESTBOOK',
  },
  {
    id: 'quest_feed_pet',
    title: 'Pet Caretaker',
    description: 'Feed your companion pet 2 treats.',
    difficulty: 'EASY',
    goal: 2,
    rewardCoins: 30,
    rewardGems: 0,
    actionType: 'FEED_PET',
  },
  {
    id: 'quest_tip_player',
    title: 'Generous Neighbor',
    description: 'Leave a tip in any player loft tip jar.',
    difficulty: 'EASY',
    goal: 1,
    rewardCoins: 25,
    rewardGems: 0,
    actionType: 'TIP_PLAYER',
  },
  {
    id: 'quest_change_mood',
    title: 'Ambiance Designer',
    description: 'Change your personal loft lighting mood.',
    difficulty: 'EASY',
    goal: 1,
    rewardCoins: 20,
    rewardGems: 0,
    actionType: 'CHANGE_MOOD',
  },

  // Medium Quests
  {
    id: 'quest_pizza_medium',
    title: 'Master of Dough',
    description: 'Assemble 3 Perfect pizzas in the Pizza Chef mini-game.',
    difficulty: 'MEDIUM',
    goal: 3,
    rewardCoins: 75,
    rewardGems: 0,
    actionType: 'PIZZA_PERFECT',
  },
  {
    id: 'quest_trade_medium',
    title: 'Fair Trader',
    description: 'Complete a secure P2P trade with another player.',
    difficulty: 'MEDIUM',
    goal: 1,
    rewardCoins: 50,
    rewardGems: 0,
    actionType: 'P2P_TRADE',
  },
  {
    id: 'quest_fish_medium',
    title: 'Deep Angler',
    description: 'Catch 12 fish at the water spot.',
    difficulty: 'MEDIUM',
    goal: 12,
    rewardCoins: 80,
    rewardGems: 0,
    actionType: 'CATCH_FISH',
  },
  {
    id: 'quest_visit_medium',
    title: 'Grand Explorer',
    description: 'Visit 10 different lofts and public spaces.',
    difficulty: 'MEDIUM',
    goal: 10,
    rewardCoins: 65,
    rewardGems: 0,
    actionType: 'VISIT_ROOMS',
  },

  // Hard Quests
  {
    id: 'quest_playtime_hard',
    title: 'Haven Regular',
    description: 'Spend 30 minutes online in HavenWorld.',
    difficulty: 'HARD',
    goal: 30,
    rewardCoins: 100,
    rewardGems: 0,
    actionType: 'PLAY_MINUTES',
  },
  {
    id: 'quest_craft_hard',
    title: 'Artisan Tinkerer',
    description: 'Craft 1 exclusive item in the Workshop.',
    difficulty: 'HARD',
    goal: 1,
    rewardCoins: 120,
    rewardGems: 1,
    actionType: 'CRAFT_ITEM',
  },
  {
    id: 'quest_pizza_hard',
    title: 'Pizzaiolo Supreme',
    description: 'Assemble 8 Perfect pizzas in Pizza Chef.',
    difficulty: 'HARD',
    goal: 8,
    rewardCoins: 150,
    rewardGems: 1,
    actionType: 'PIZZA_PERFECT',
  },
];

/**
 * Returns the deterministic day-of-year integer (1–366) in UTC
 */
export function getUtcDayOfYear(date = new Date()): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Returns exactly 3 daily quests (1 Easy, 1 Medium, 1 Hard) deterministic by UTC date
 */
export function getDailyQuests(date = new Date()): QuestTemplate[] {
  const dayOfYear = getUtcDayOfYear(date);
  const year = date.getUTCFullYear();
  const seed = year * 1000 + dayOfYear;

  const easyPool = QUEST_POOL.filter((q) => q.difficulty === 'EASY');
  const medPool = QUEST_POOL.filter((q) => q.difficulty === 'MEDIUM');
  const hardPool = QUEST_POOL.filter((q) => q.difficulty === 'HARD');

  const easyIndex = seed % easyPool.length;
  const medIndex = (seed * 7 + 3) % medPool.length;
  const hardIndex = (seed * 13 + 5) % hardPool.length;

  return [easyPool[easyIndex], medPool[medIndex], hardPool[hardIndex]];
}
