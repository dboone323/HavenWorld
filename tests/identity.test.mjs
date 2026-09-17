import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import { DEFAULT_AVATAR, createIdentity, formatResidency, normalizeAvatar } from '../src/client/shared/identity-model.js';
import { advanceAura, avatarFrame, drawModularAvatar } from '../src/client/shared/avatar.js';
process.env.DB_FORCE_SQLITE = '1';
process.env.DB_PATH = ':memory:';
const db = await import('../src/server/db.ts');
after(() => db.close());

test('identity dispatch persists status, presets and earned titles through real SQLite', async () => {
  const account = await db.signupAccount('IdentityUnit', 'test-only-password');
  assert.ok(account.id);
  const registeredAt = await db.getRegistrationDate(account.id);
  const sent = [];
  const ws = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  const player = { id: account.id, name: account.name, room: 'plaza', ws, avatar: { ...DEFAULT_AVATAR },
    x: 0, y: 0, targetX: 0, targetY: 0, coins: 1000, gems: 50, lastDailyClaim: 0,
    friends: [], authUserId: account.id, identity: createIdentity(account.id) };
  const rooms = new RoomManager(); rooms.join('plaza', player);
  const ctx = { rooms, db, ws };
  async function dispatch(type, payload, expected = 'IDENTITY_UPDATED') {
    sent.length = 0;
    await handleMessage({ type, payload }, player, ctx);
    const response = sent.find(msg => msg.type === expected);
    assert.ok(response, JSON.stringify(sent));
    return response.payload;
  }
  await dispatch('UPDATE_IDENTITY', { statusMessage: '<b>Building</b> a home' });
  assert.equal((await db.loadIdentity(account.id)).statusMessage, 'Building a home');
  await dispatch('SAVE_PRESET', { slot: 0, avatar: { shirtStyle: 'hoodie', shoesColor: '#123456' } });
  await dispatch('APPLY_PRESET', { slot: 0 });
  assert.equal((await db.loadIdentity(account.id)).outfit.shirtStyle, 'hoodie');
  await dispatch('UPDATE_IDENTITY', { title: 'traveler' }, 'IDENTITY_ERROR');
  await handleMessage({ type: 'SWITCH_ROOM', payload: { roomId: 'sanctuary_loft' } }, player, ctx);
  await dispatch('UPDATE_IDENTITY', { title: 'traveler', pinnedBadges: ['world_traveler'] });
  assert.equal((await db.loadIdentity(account.id)).title, 'traveler');
  await dispatch('UPDATE_AVATAR', { avatar: { aura: 'halo' } });
  await dispatch('UPDATE_AVATAR', { avatar: { aura: 'sparkles' } }, 'IDENTITY_ERROR');
  await dispatch('SAVE_PRESET', { slot: 3 }, 'IDENTITY_ERROR');
  await db.savePlayerName(account.id, 'IdentityRenamed');
  assert.equal(await db.getRegistrationDate(account.id), registeredAt);
});

test('avatar input is allowlisted and dates do not fabricate legacy residency', () => {
  const avatar = normalizeAvatar({ shirtColor: 'red', shoesColor: '#abc', admin: true });
  assert.equal(avatar.shirtColor, DEFAULT_AVATAR.shirtColor);
  assert.equal(avatar.shoesColor, '#abc');
  assert.equal(avatar.admin, undefined);
  assert.equal(formatResidency(null), 'Registration date unavailable');
  assert.equal(formatResidency('2026-01-01T00:00:00Z', Date.parse('2026-01-03T00:00:00Z')), 'Resident since: January 2026 (2 days ago)');
});

test('animation frames vary and particle emitters remain bounded and clear on unequip', () => {
  assert.notEqual(avatarFrame('walk', 0).stride, avatarFrame('walk', 220).stride);
  assert.notEqual(avatarFrame('run', 220).frame, avatarFrame('walk', 220).frame);
  const state = {};
  for (let i = 0; i < 10000; i++) advanceAura(state, 'halo', 0.1);
  assert.ok(state.particles.length > 0 && state.particles.length <= 24);
  advanceAura(state, 'none', 0.1);
  assert.equal(state.particles.length, 0);
});

test('seated clothing keeps shoes at folded leg ends with stable layer ordering', () => {
  const calls = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, ellipse() {}, fill() {},
    fillRect(x, y, w, h) { calls.push({ color: this.fillStyle, x, y, w, h }); } };
  drawModularAvatar(ctx, DEFAULT_AVATAR, 0, 0, { pose: 'sit' });
  const pants = calls.filter(c => c.color === DEFAULT_AVATAR.pantsColor);
  const shoes = calls.filter(c => c.color === DEFAULT_AVATAR.shoesColor);
  assert.equal(pants.length, 2);
  assert.equal(shoes.length, 2);
  pants.forEach((leg, i) => {
    assert.equal(leg.h, 5);
    assert.equal(shoes[i].x, leg.x + leg.w - 2);
    assert.equal(shoes[i].y + shoes[i].h, leg.y + leg.h);
  });
  assert.ok(calls.indexOf(pants[0]) < calls.indexOf(shoes[0]));
  assert.ok(calls.indexOf(shoes[1]) < calls.findIndex(c => c.color === DEFAULT_AVATAR.shirtColor));
});

