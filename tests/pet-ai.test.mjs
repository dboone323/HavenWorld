import test from 'node:test';
import assert from 'node:assert/strict';
import { createPet, advancePetAI, petInteract, getPetFacing, getDistance } from '../src/shared/pet.ts';

test('Pet initialization creates valid pet entity with default idle state', () => {
  const pet = createPet('pet_cat_1', 'owner_1', 'loft_1', 'pet_cat', 'Whiskers', 4, 4);
  assert.equal(pet.id, 'pet_cat_1');
  assert.equal(pet.name, 'Whiskers');
  assert.equal(pet.x, 4);
  assert.equal(pet.y, 4);
  assert.equal(pet.state, 'idle');
  assert.equal(pet.facing, 'SE');
});

test('getPetFacing accurately maps cardinal vectors', () => {
  assert.equal(getPetFacing(2, 2, 5, 2), 'SE');
  assert.equal(getPetFacing(5, 2, 2, 2), 'NW');
  assert.equal(getPetFacing(2, 2, 2, 5), 'SW');
  assert.equal(getPetFacing(2, 5, 2, 2), 'NE');
});

test('advancePetAI steps wander movement toward target and clamps to grid boundaries', () => {
  let pet = createPet('pet_dog_1', 'owner_1', 'loft_1', 'pet_dog', 'Buddy', 3, 3);
  pet.state = 'wander';
  pet.targetX = 5;
  pet.targetY = 3;

  // Step AI by 500ms
  pet = advancePetAI(pet, 500, null, 10, 10);
  assert.ok(pet.x > 3, 'Pet moved toward targetX');
  assert.ok(pet.x <= 5, 'Pet did not overshoot targetX');

  // Step AI until arrival (wander state becomes idle on arrival)
  while (pet.state === 'wander') {
    pet = advancePetAI(pet, 200, null, 10, 10);
  }
  assert.equal(pet.x, 5, 'Pet arrived at target');
  assert.equal(pet.state, 'idle', 'Pet returned to idle after arriving');
});

test('Pet AI switches to follow state when owner moves far away', () => {
  let pet = createPet('pet_dragon_1', 'owner_1', 'loft_1', 'pet_dragon', 'Draco', 1, 1);
  const ownerPos = { x: 5, y: 5 };

  // Owner is far away (> 4.5 tiles: dist from (1,1) to (5,5) is 5.65)
  pet = advancePetAI(pet, 100, ownerPos, 14, 14);
  assert.equal(pet.state, 'follow', 'Pet entered follow state');

  // Step follow movement until pet reaches owner's vicinity
  while (pet.state === 'follow') {
    pet = advancePetAI(pet, 200, ownerPos, 14, 14);
  }
  const finalDist = getDistance(pet.x, pet.y, ownerPos.x, ownerPos.y);
  assert.ok(finalDist <= 2.0, `Pet stopped close to owner: ${finalDist}`);
  assert.equal(pet.state, 'idle', 'Pet switched back to idle near owner');
});

test('petInteract triggers expressive reaction emote', () => {
  let pet = createPet('pet_cat_1', 'owner_1', 'loft_1', 'pet_cat', 'Mochi', 3, 3);
  pet = petInteract(pet, 'pet');
  assert.equal(pet.state, 'react');
  assert.equal(pet.reactionEmote, '❤️');
  assert.equal(pet.reactionTimerMs, 3000);

  // Advance time past reaction timer
  pet = advancePetAI(pet, 3500);
  assert.equal(pet.reactionEmote, '');
  assert.equal(pet.state, 'idle');
});
