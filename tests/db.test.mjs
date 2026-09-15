import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'haven-db-')), 'test.db');

const db = await import(new URL('../src/server/db.js', import.meta.url));

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

after(() => {
  db.close();
  process.exit(0);
});
