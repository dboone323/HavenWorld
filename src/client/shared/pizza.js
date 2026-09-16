// HavenWorld — Pizza Chef recipe + scoring logic (browser-compatible ES module)
// Source: src/shared/pizza.ts — TypeScript type annotations stripped for browser execution.

export const RECIPES = [
  { name: 'Margherita',    steps: ['Crust', 'Sauce', 'Cheese', 'Basil'] },
  { name: 'Funghi Rustica', steps: ['Crust', 'Sauce', 'Cheese', 'Mushrooms'] },
  { name: 'Green Garden',  steps: ['Crust', 'Cheese', 'Mushrooms', 'Basil'] },
];

export function pickRecipe(rng = Math.random) {
  return RECIPES[Math.floor(rng() * RECIPES.length)];
}

export function matchRecipe(ingredients, recipe = RECIPES[0]) {
  if (!Array.isArray(ingredients) || ingredients.length !== recipe.steps.length) return false;
  return ingredients.every((value, index) => value === recipe.steps[index]);
}

export function scoreCoins(pizzas) {
  return pizzas * 100;
}
