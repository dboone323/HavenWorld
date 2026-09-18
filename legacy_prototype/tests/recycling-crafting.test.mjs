import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import * as db from '../src/server/db.ts';
import { calculateSalvageYield, canCraftRecipe, WORKSHOP_RECIPES } from '../src/shared/crafting.ts';

function makeSock() {
  const sent = [];
  return {
    readyState: 1,
    send(data) { sent.push(JSON.parse(data)); },
    sent,
  };
}

function makePlayer(prefix) {
  const id = prefix + '_' + Math.random().toString(36).substring(2, 9);
  return {
    id,
    name: 'Player_' + id,
    room: 'plaza',
    x: 2,
    y: 2,
    targetX: 2,
    targetY: 2,
    coins: 1000,
    gems: 50,
    avatar: { skin: '#f5cba7' },
    lastChat: null,
    ws: makeSock(),
    lastDailyClaim: 0,
    friends: [],
    authUserId: id,
    materials: { scrap_metal: 0, timber: 0 },
  };
}

test('Salvage calculations accurately compute scrap metal and timber yields', () => {
  const sofaYield = calculateSalvageYield('sofa');
  assert.equal(sofaYield.scrap_metal, 4);
  assert.equal(sofaYield.timber, 8);

  const neonYield = calculateSalvageYield('neon');
  assert.equal(neonYield.scrap_metal, 12);
  assert.equal(neonYield.timber, 1);
});

test('RECYCLE_ITEM removes furniture from inventory and credits crafting materials', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('recycler');
  await db.initPlayerProfile(p.id, p.name);
  await db.addItem(p.id, 'sofa', 1);

  // Recycle sofa
  await handleMessage({
    type: 'RECYCLE_ITEM',
    payload: { itemType: 'sofa' }
  }, p, { rooms, db, ws: p.ws });

  const recycleMsg = p.ws.sent.find(m => m.type === 'RECYCLE_SUCCESS');
  assert.ok(recycleMsg, 'Received RECYCLE_SUCCESS');
  assert.equal(recycleMsg.payload.itemType, 'sofa');
  assert.equal(recycleMsg.payload.gained.scrap_metal, 4);
  assert.equal(recycleMsg.payload.gained.timber, 8);

  // Check persisted materials in SQLite
  const savedMats = await db.getPlayerMaterials(p.id);
  assert.equal(savedMats.scrap_metal, 4);
  assert.equal(savedMats.timber, 8);
});

test('CRAFT_ITEM validates materials, crafts workshop item, and deducts resources', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('crafter');
  await db.initPlayerProfile(p.id, p.name);

  // Give player materials for steampunk_sofa (costs 15 scrap_metal, 20 timber)
  await db.savePlayerMaterials(p.id, { scrap_metal: 20, timber: 25 });
  p.materials = { scrap_metal: 20, timber: 25 };

  // 1. Craft steampunk_sofa
  await handleMessage({
    type: 'CRAFT_ITEM',
    payload: { recipeId: 'steampunk_sofa' }
  }, p, { rooms, db, ws: p.ws });

  const craftMsg = p.ws.sent.find(m => m.type === 'CRAFT_SUCCESS');
  assert.ok(craftMsg, 'Received CRAFT_SUCCESS');
  assert.equal(craftMsg.payload.recipeId, 'steampunk_sofa');

  // Materials deducted: 20 - 15 = 5 scrap_metal, 25 - 20 = 5 timber
  assert.equal(p.materials.scrap_metal, 5);
  assert.equal(p.materials.timber, 5);

  // Crafted item added to inventory
  const inv = await db.getInventory(p.id);
  const hasCrafted = inv.some(i => i.item_type === 'steampunk_sofa' && i.quantity > 0);
  assert.equal(hasCrafted, true, 'Steampunk sofa in inventory');

  // 2. Attempt to craft again with insufficient materials
  await handleMessage({
    type: 'CRAFT_ITEM',
    payload: { recipeId: 'steampunk_sofa' }
  }, p, { rooms, db, ws: p.ws });

  const errorMsg = p.ws.sent.find(m => m.type === 'CRAFTING_ERROR');
  assert.ok(errorMsg, 'CRAFTING_ERROR received for insufficient materials');
});
