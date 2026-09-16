import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-db-')), 'test.db');

const db = await import(new URL('../src/server/db.ts', import.meta.url));

test('db boots in sqlite test mode', () => {
  assert.equal(db.getMode(), 'sqlite');
  assert.equal(db.isConfigured(), false);
});

test('initPlayerProfile is idempotent', async () => {
  await db.initPlayerProfile('u_db1', 'Alpha');
  await db.initPlayerProfile('u_db1', 'Alpha'); // ON CONFLICT DO NOTHING
});

test('addCoins does not throw', async () => {
  await db.addCoins('u_coins', 100);
});

test('saveAvatar does not throw', async () => {
  await db.saveAvatar('u_avatar', {
    skin: '#fff', hairStyle: 'spikey', hairColor: '#000',
    shirtColor: '#111', pantsColor: '#222'
  });
});

test('furniture CRUD round-trips', async () => {
  await db.removeFurniture('f_dbtest');
  await db.addFurniture('test_room', { id: 'f_dbtest', type: 'plant', x: 2, y: 3, rotation: 1 });
  const furn = await db.getRoomFurniture('test_room');
  assert.ok(furn && furn.some(f => f.id === 'f_dbtest'));
  await db.removeFurniture('f_dbtest');
  const after = await db.getRoomFurniture('test_room');
  assert.ok(!after || !after.some(f => f.id === 'f_dbtest'));
});

test('friends table CRUD', async () => {
  await db.initPlayerProfile('u_friend_a', 'Alice');
  await db.initPlayerProfile('u_friend_b', 'Bob');

  // Send friend request
  const result = await db.sendFriendRequest('u_friend_a', 'u_friend_b');
  assert.equal(result.success, true);

  // Check pending requests for Bob
  const pending = await db.getPendingFriendRequests('u_friend_b');
  assert.ok(pending.some(r => r.requesterId === 'u_friend_a'));

  // Alice should have no accepted friends yet
  const aliceFriendsBefore = await db.getFriends('u_friend_a');
  assert.equal(aliceFriendsBefore.length, 0);

  // Bob accepts
  const acceptResult = await db.acceptFriendRequest('u_friend_b', 'u_friend_a');
  assert.equal(acceptResult.success, true);

  // Now both should have each other as friends
  const aliceFriends = await db.getFriends('u_friend_a');
  const bobFriends = await db.getFriends('u_friend_b');
  assert.ok(aliceFriends.some(f => f.friendId === 'u_friend_b'));
  assert.ok(bobFriends.some(f => f.friendId === 'u_friend_a'));

  // areFriends should return true
  const are = await db.areFriends('u_friend_a', 'u_friend_b');
  assert.equal(are, true);
  const areNot = await db.areFriends('u_friend_a', 'u_friend_z');
  assert.equal(areNot, false);
});

test('private messages persist and retrieve', async () => {
  await db.initPlayerProfile('u_pm_a', 'Alice');
  await db.initPlayerProfile('u_pm_b', 'Bob');

  // Save a message
  await db.saveMessage('u_pm_a', 'u_pm_b', 'Hello Bob!');
  await db.saveMessage('u_pm_b', 'u_pm_a', 'Hi Alice!');

  // Bob retrieves his messages
  const bobMessages = await db.getMessages('u_pm_b');
  assert.ok(bobMessages.length > 0, 'bob has messages');
  assert.equal(bobMessages[0].text, 'Hello Bob!');
  assert.equal(bobMessages[0].senderId, 'u_pm_a');
});

test('inventory add/remove round-trips', async () => {
  await db.initPlayerProfile('u_inv', 'Inv');
  await db.addItem('u_inv', 'sofa', 1);
  await db.addItem('u_inv', 'sofa', 2); // now has 3 sofas

  const inv = await db.getInventory('u_inv');
  const sofas = inv.find(i => i.item_type === 'sofa');
  assert.ok(sofas, 'sofa in inventory');
  assert.equal(sofas.quantity, 3);

  await db.removeItem('u_inv', 'sofa', 2);
  const inv2 = await db.getInventory('u_inv');
  const sofas2 = inv2.find(i => i.item_type === 'sofa');
  assert.ok(sofas2, 'sofa still in inventory');
  assert.equal(sofas2.quantity, 1);

  await db.removeItem('u_inv', 'sofa', 1);
  const inv3 = await db.getInventory('u_inv');
  assert.ok(!inv3.find(i => i.item_type === 'sofa'), 'sofa removed from inventory');
});

after(() => {
  db.close();
  process.exit(0);
});
