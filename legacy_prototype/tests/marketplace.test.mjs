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

function makePlayer(prefix, room = 'plaza', coins = 5000) {
  const id = prefix + '_' + Math.random().toString(36).substring(2, 9);
  return {
    id,
    name: 'Player_' + id,
    room,
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
  };
}

test('Marketplace listing removes item into escrow and browse lists it', async () => {
  const rooms = new RoomManager();
  const seller = makePlayer('seller_list', 'plaza');
  await db.initPlayerProfile(seller.id, seller.name);
  await db.addItem(seller.id, 'tv', 1);

  // 1. List item for 300 coins
  await handleMessage({
    type: 'LIST_MARKETPLACE_ITEM',
    payload: { itemType: 'tv', priceCoins: 300 }
  }, seller, { rooms, db, ws: seller.ws });

  const successMsg = seller.ws.sent.find(m => m.type === 'MARKETPLACE_SUCCESS');
  assert.ok(successMsg, 'Marketplace listing succeeded');

  // Item was removed from seller active inventory into escrow
  const inv = await db.getInventory(seller.id);
  const hasTv = inv.some(i => i.item_type === 'tv' && i.quantity > 0);
  assert.equal(hasTv, false, 'Item is in escrow, no longer in active inventory');

  // 2. Browse listings
  const buyer = makePlayer('buyer_browse', 'plaza');
  await handleMessage({
    type: 'BROWSE_MARKETPLACE',
    payload: { query: 'tv' }
  }, buyer, { rooms, db, ws: buyer.ws });

  const listingsMsg = buyer.ws.sent.find(m => m.type === 'MARKETPLACE_LISTINGS');
  assert.ok(listingsMsg, 'BROWSE_MARKETPLACE returned listings');
  const tvListing = listingsMsg.payload.listings.find(l => l.itemType === 'tv' && l.sellerId === seller.id);
  assert.ok(tvListing, 'Found TV listing in marketplace');
  assert.equal(tvListing.priceCoins, 300);
});

test('Buying marketplace item deducts 5% transaction tax sink and delivers to offline seller', async () => {
  const rooms = new RoomManager();
  const seller = makePlayer('seller_buy', 'plaza', 1000);
  const buyer = makePlayer('buyer_buy', 'plaza', 2000);

  await db.initPlayerProfile(seller.id, seller.name);
  await db.initPlayerProfile(buyer.id, buyer.name);
  const initialSellerProfile = await db.loadPlayerProfile(seller.id);
  const initialSellerCoins = initialSellerProfile.coins;

  await db.addItem(seller.id, 'arcade', 1);

  // List arcade for 500 coins
  const listRes = await db.createMarketplaceListing(seller.id, seller.name, 'arcade', 500);
  assert.ok(listRes.success, 'Listing created');

  // Buyer purchases item
  await handleMessage({
    type: 'BUY_MARKETPLACE_ITEM',
    payload: { listingId: listRes.listingId }
  }, buyer, { rooms, db, ws: buyer.ws });

  assert.equal(buyer.coins, 1500, 'Buyer paid 500 coins');

  // Verify buyer received arcade
  const buyerInv = await db.getInventory(buyer.id);
  const hasArcade = buyerInv.some(i => i.item_type === 'arcade' && i.quantity > 0);
  assert.equal(hasArcade, true, 'Buyer received arcade item');

  // Verify 5% tax sink calculation: 500 * 0.05 = 25 sink. Seller payout = 475.
  const sellerProfile = await db.loadPlayerProfile(seller.id);
  assert.equal(sellerProfile.coins, initialSellerCoins + 475, 'Offline seller credited 475 coins after 5% deflationary tax sink');
});

test('Cancelling active marketplace listing returns item from escrow to seller', async () => {
  const rooms = new RoomManager();
  const seller = makePlayer('seller_cancel', 'plaza');
  await db.initPlayerProfile(seller.id, seller.name);
  await db.addItem(seller.id, 'sofa', 1);

  const listRes = await db.createMarketplaceListing(seller.id, seller.name, 'sofa', 400);
  assert.ok(listRes.success);

  // Cancel listing
  await handleMessage({
    type: 'CANCEL_MARKETPLACE_LISTING',
    payload: { listingId: listRes.listingId }
  }, seller, { rooms, db, ws: seller.ws });

  const cancelMsg = seller.ws.sent.find(m => m.type === 'MARKETPLACE_SUCCESS');
  assert.ok(cancelMsg);

  // Item returned to seller inventory
  const inv = await db.getInventory(seller.id);
  const hasSofa = inv.some(i => i.item_type === 'sofa' && i.quantity > 0);
  assert.equal(hasSofa, true, 'Sofa returned to inventory from escrow');
});
