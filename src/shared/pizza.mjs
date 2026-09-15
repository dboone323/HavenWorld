/** HavenWorld — Pizza Chef recipe + scoring logic (shared, isomorphic). */

export const RECIPES = [
  { name: 'Margherita',    steps: ['Crust', 'Sauce', 'Cheese', 'Basil'] },
  { name: 'Funghi Rustica', steps: ['Crust', 'Sauce', 'Cheese', 'Mushrooms'] },
  { name: 'Green Garden',  steps: ['Crust', 'Cheese', 'Mushrooms', 'Basil'] }
];

/** Pick a random recipe. Pass a seeded RNG for deterministic tests. */
export function pickRecipe(rng = Math.random) {
  return RECIPES[Math.floor(rng() * RECIPES.length)];
}

/** Validate assembled ingredients against a recipe (order matters). */
export function matchRecipe(ingredients, recipe = RECIPES[0]) {
  if (!recipe) recipe = RECIPES[0];
  if (!Array.isArray(ingredients) || ingredients.length !== recipe.steps.length) return false;
  return ingredients.every((value, index) => value === recipe.steps[index]);
}

/** HavenCoin payout for completing `pizzas` recipes. */
export function scoreCoins(pizzas) {
  return pizzas * 100;
}
