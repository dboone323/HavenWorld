/**
 * HavenWorld — Pizza Chef recipe + scoring logic (shared, isomorphic).
 */

export interface Recipe {
  name: string;
  steps: readonly string[];
}

export const RECIPES: readonly Recipe[] = [
  { name: 'Margherita',    steps: ['Crust', 'Sauce', 'Cheese', 'Basil'] },
  { name: 'Funghi Rustica', steps: ['Crust', 'Sauce', 'Cheese', 'Mushrooms'] },
  { name: 'Green Garden',  steps: ['Crust', 'Cheese', 'Mushrooms', 'Basil'] },
];

/** Pick a random recipe. Pass a seeded RNG for deterministic tests. */
export function pickRecipe(rng: () => number = Math.random): Recipe {
  return RECIPES[Math.floor(rng() * RECIPES.length)];
}

/** Validate assembled ingredients against a recipe (order matters). */
export function matchRecipe(ingredients: string[], recipe: Recipe = RECIPES[0]): boolean {
  if (!Array.isArray(ingredients) || ingredients.length !== recipe.steps.length) return false;
  return ingredients.every((value, index) => value === recipe.steps[index]);
}

/** HavenCoin payout for completing pizzas recipes. */
export function scoreCoins(pizzas: number): number {
  return pizzas * 100;
}