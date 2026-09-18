import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/rooms.ts';
import { handleMessage } from '../src/server/protocol.ts';
import * as db from '../src/server/db.ts';

function makeSock() {
  const sent = [];
  return {
    readyState: 1,
    send(data) { sent.push(JSON.parse(data)); },
    sent,
  };
}

function makePlayer(prefix, coins = 2000) {
  const id = prefix + '_' + Math.random().toString(36).substring(2, 9);
  return {
    id,
    name: 'Player_' + id,
    room: 'plaza',
    x: 2,
    y: 2,
    targetX: 2,
    targetY: 2,
    coins,
    gems: 50,
    avatar: { skin: '#f5cba7' },
    lastChat: null,
    ws: makeSock(),
    lastDailyClaim: 0,
    friends: [],
    authUserId: id,
    isVip: false,
    vipExpiresAt: null,
  };
}

test('BUY_VIP_MEMBERSHIP activates 30-day Club Haven status and sets VIP perks', async () => {
  const rooms = new RoomManager();
  const p = makePlayer('vip_member', 2500);
  await db.initPlayerProfile(p.id, p.name);
  await db.addCoins(p.id, 2500);

  // Buy VIP membership (costs 1,000 coins)
  await handleMessage({
    type: 'BUY_VIP_MEMBERSHIP',
    payload: null
  }, p, { rooms, db, ws: p.ws });

  assert.equal(p.coins, 1500, '1,000 coins deducted');
  assert.equal(p.isVip, true, 'Player has VIP flag');
  assert.ok(p.vipExpiresAt, 'Expiration date is set');

  const vipMsg = p.ws.sent.find(m => m.type === 'VIP_UPDATED');
  assert.ok(vipMsg, 'VIP_UPDATED message sent');
  assert.equal(vipMsg.payload.isVip, true);

  // Check persistent SQLite VIP status
  const dbVip = await db.getVipStatus(p.id);
  assert.equal(dbVip.isVip, true);
  assert.ok(new Date(dbVip.expiresAt).getTime() > Date.now());
});

test('VIP seller enjoys reduced 2% marketplace tax rate (instead of standard 5%)', async () => {
  const rooms = new RoomManager();
  const vipSeller = makePlayer('vip_seller', 100);
  const buyer = makePlayer('buyer_vip', 2000);

  await db.initPlayerProfile(vipSeller.id, vipSeller.name);
  await db.initPlayerProfile(buyer.id, buyer.name);
  await db.setVipMembership(vipSeller.id, 30);
  await db.addItem(vipSeller.id, 'tv', 1);

  const initialSellerProfile = await db.loadPlayerProfile(vipSeller.id);
  const initialSellerCoins = initialSellerProfile.coins;

  // List item for 1,000 coins
  const listRes = await db.createMarketplaceListing(vipSeller.id, vipSeller.name, 'tv', 1000);
  assert.ok(listRes.success);

  // Buyer purchases listing
  await db.buyMarketplaceListing(listRes.listingId, buyer.id, 2000);

  // With VIP: 2% tax = 20 coins sink. Seller payout = 980 coins.
  const updatedSellerProfile = await db.loadPlayerProfile(vipSeller.id);
  assert.equal(updatedSellerProfile.coins, initialSellerCoins + 980, 'VIP seller received 980 coins (2% tax)');
});

test('BUY_VIP_MEMBERSHIP rejects when player has insufficient coins', async () => {
  const rooms = new RoomManager();
  const poorPlayer = makePlayer('poor_player', 500);
  await db.initPlayerProfile(poorPlayer.id, poorPlayer.name);

  await handleMessage({
    type: 'BUY_VIP_MEMBERSHIP',
    payload: null
  }, poorPlayer, { rooms, db, ws: poorPlayer.ws });

  const errorMsg = poorPlayer.ws.sent.find(m => m.type === 'FURNITURE_ERROR');
  assert.ok(errorMsg, 'Error received for insufficient funds');
  assert.equal(poorPlayer.isVip, false);
});
