import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeManager } from '../src/server/trade.ts';

test('TradeManager initializes pending session', () => {
  const tm = new TradeManager();
  const s = tm.createSession('p1', 'p2');
  assert.ok(s.id.startsWith('tr_'));
  assert.equal(s.player1Id, 'p1');
  assert.equal(s.player2Id, 'p2');
  assert.equal(s.status, 'pending');
  assert.equal(s.player1Offer.coins, 0);
  assert.deepEqual(s.player1Offer.items, []);
});

test('acceptRequest activates session only for recipient', () => {
  const tm = new TradeManager();
  const s = tm.createSession('p1', 'p2');

  const invalid = tm.acceptRequest(s.id, 'intruder');
  assert.equal(invalid, null);

  const active = tm.acceptRequest(s.id, 'p2');
  assert.ok(active);
  assert.equal(active.status, 'active');
});

test('anti-scam: updating offer unlocks and unconfirms both parties', () => {
  const tm = new TradeManager();
  const s = tm.createSession('p1', 'p2');
  tm.acceptRequest(s.id, 'p2');

  // Both lock offers
  tm.lockOffer(s.id, 'p1', true);
  tm.lockOffer(s.id, 'p2', true);
  assert.equal(s.player1Offer.locked, true);
  assert.equal(s.player2Offer.locked, true);

  // Player 1 modifies offer (e.g. swaps item or changes coins)
  tm.updateOffer(s.id, 'p1', 500, ['rare_item']);

  // Assert both offers are immediately unlocked and unconfirmed
  assert.equal(s.player1Offer.coins, 500);
  assert.deepEqual(s.player1Offer.items, ['rare_item']);
  assert.equal(s.player1Offer.locked, false, 'player1 offer unlocked');
  assert.equal(s.player2Offer.locked, false, 'player2 offer unlocked');
  assert.equal(s.player1Offer.confirmed, false);
  assert.equal(s.player2Offer.confirmed, false);
});

test('confirmTrade requires both locked before confirming and completing', () => {
  const tm = new TradeManager();
  const s = tm.createSession('p1', 'p2');
  tm.acceptRequest(s.id, 'p2');

  // Attempt confirm while unlocked
  let res = tm.confirmTrade(s.id, 'p1');
  assert.equal(res.ready, false);
  assert.equal(s.player1Offer.confirmed, false);

  // Lock both
  tm.lockOffer(s.id, 'p1', true);
  tm.lockOffer(s.id, 'p2', true);

  // P1 confirms
  res = tm.confirmTrade(s.id, 'p1');
  assert.equal(res.ready, false);
  assert.equal(s.player1Offer.confirmed, true);
  assert.equal(s.player2Offer.confirmed, false);

  // P2 confirms -> Trade executes
  res = tm.confirmTrade(s.id, 'p2');
  assert.equal(res.ready, true);
  assert.equal(res.session.status, 'completed');
});

test('cancelTrade cleans up active session for both players', () => {
  const tm = new TradeManager();
  const s = tm.createSession('p1', 'p2');
  assert.ok(tm.getSessionForPlayer('p1'));
  assert.ok(tm.getSessionForPlayer('p2'));

  tm.cancelTrade(s.id);
  assert.equal(tm.getSessionForPlayer('p1'), undefined);
  assert.equal(tm.getSessionForPlayer('p2'), undefined);
});
