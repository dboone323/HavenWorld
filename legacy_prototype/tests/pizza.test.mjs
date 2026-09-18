import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, pickRecipe, matchRecipe, scoreCoins } from '../src/shared/pizza.ts';

test('RECIPES ships three starter recipes', () => {
  assert.equal(RECIPES.length, 3);
  assert.equal(RECIPES[0].steps.length, 4);
});

test('matchRecipe accepts an exact, ordered match', () => {
  assert.equal(matchRecipe(['Crust', 'Sauce', 'Cheese', 'Basil'], RECIPES[0]), true);
});

test('matchRecipe is order-sensitive', () => {
  assert.equal(matchRecipe(['Cheese', 'Sauce', 'Crust', 'Basil'], RECIPES[0]), false);
});

test('matchRecipe rejects length mismatches', () => {
  assert.equal(matchRecipe(['Crust'], RECIPES[0]), false);
  assert.equal(matchRecipe([], RECIPES[0]), false);
  assert.equal(matchRecipe(null, RECIPES[0]), false);
});

test('pickRecipe honours a seeded RNG', () => {
  assert.equal(pickRecipe(() => 0), RECIPES[0]);
  assert.equal(pickRecipe(() => 0.99), RECIPES[2]);
});

test('scoreCoins scales by 100 per pizza', () => {
  assert.equal(scoreCoins(0), 0);
  assert.equal(scoreCoins(5), 500);
});
