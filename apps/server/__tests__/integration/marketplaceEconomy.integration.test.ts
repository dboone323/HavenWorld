import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';
import { EconomySecurity } from '../../src/game/economy';
import { ShopService } from '../../src/services/ShopService';
import { getCurrentEpoch, getFeaturedItems } from '@havenworld/shared';

describe('Track 4 Integration: Economy, Progression, and Trading', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('4.2: Dual Currency Model (HavenCoins & HavenGems)', () => {
    it('should award HavenGems atomically and persist in user record', async () => {
      const user = await createTestUser({ havenGems: 10 });
      const result = await EconomySecurity.awardGems(user.id, 25, 'PASSPORT_MILESTONE');

      expect(result.success).toBe(true);
      expect(result.newGemBalance).toBe(35);

      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(dbUser?.havenGems).toBe(35);
    });

    it('should reject invalid or non-positive gem awards', async () => {
      const user = await createTestUser();
      await expect(EconomySecurity.awardGems(user.id, -5)).rejects.toThrow(/positive integer/i);
      await expect(EconomySecurity.awardGems(user.id, 0)).rejects.toThrow(/positive integer/i);
    });
  });

  describe('4.5: Rotating Stock (48-hour deterministic epoch)', () => {
    it('should deterministically calculate epoch and rotate 3 featured items', () => {
      const epoch1Time = 1700000000000;
      const epoch2Time = epoch1Time + 172_800_000; // +48 hours

      const epoch1 = getCurrentEpoch(epoch1Time);
      const epoch2 = getCurrentEpoch(epoch2Time);
      expect(epoch2).toBe(epoch1 + 1);

      const featuredEpoch1 = getFeaturedItems(epoch1Time);
      const featuredEpoch1Repeat = getFeaturedItems(epoch1Time);
      expect(featuredEpoch1.length).toBe(3);
      expect(featuredEpoch1.map((i) => i.id)).toEqual(featuredEpoch1Repeat.map((i) => i.id));

      const shopState = ShopService.getShopState();
      expect(shopState.featured.length).toBe(3);
      expect(shopState.permanent.length).toBeGreaterThan(0);
      expect(shopState.epochRemainingMs).toBeGreaterThan(0);
    });
  });

  describe('4.6 & 4.11: Player Marketplace (Escrow Architecture & 5% Tax Sink)', () => {
    it('should list item in escrow, execute atomic purchase with 5% tax sink, and transfer item to buyer', async () => {
      const seller = await createTestUser({ havenCoins: 200 });
      const buyer = await createTestUser({ havenCoins: 300 });
      const item = await createTestItem({ price: 80 });

      // Put item in seller inventory
      await prisma.inventory.create({
        data: { userId: seller.id, itemId: item.id, quantity: 1 },
      });

      const sellerToken = generateTestToken(seller.id);
      const buyerToken = generateTestToken(buyer.id);

      // 1. Seller lists item for 100 coins
      const listRes = await request(app)
        .post('/api/marketplace')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ itemId: item.id, priceCoins: 100 });

      expect(listRes.status).toBe(201);
      const listingId = listRes.body.id;
      expect(listRes.body.status).toBe('ACTIVE');
      expect(listRes.body.priceCoins).toBe(100);

      // Verify item was removed from seller inventory into escrow
      const sellerInvEscrow = await prisma.inventory.findUnique({
        where: { userId_itemId: { userId: seller.id, itemId: item.id } },
      });
      expect(sellerInvEscrow).toBeNull();

      // 2. Buyer searches active listings
      const searchRes = await request(app)
        .get('/api/marketplace')
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.listings.some((l: any) => l.id === listingId)).toBe(true);

      // 3. Buyer purchases listing for 100 coins
      // 5% tax sink = 5 coins. Seller receives 95 coins.
      const buyRes = await request(app)
        .post(`/api/marketplace/${listingId}/buy`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(buyRes.status).toBe(200);
      expect(buyRes.body.success).toBe(true);
      expect(buyRes.body.taxSink).toBe(5);
      expect(buyRes.body.sellerPayout).toBe(95);
      expect(buyRes.body.buyerBalance).toBe(200); // 300 - 100
      expect(buyRes.body.sellerBalance).toBe(295); // 200 + 95

      // Verify buyer now owns item
      const buyerInv = await prisma.inventory.findUnique({
        where: { userId_itemId: { userId: buyer.id, itemId: item.id } },
      });
      expect(buyerInv).not.toBeNull();
      expect(buyerInv?.quantity).toBe(1);

      // Verify listing is now SOLD
      const dbListing = await prisma.marketplaceListing.findUnique({
        where: { id: listingId },
      });
      expect(dbListing?.status).toBe('SOLD');
      expect(dbListing?.buyerId).toBe(buyer.id);
    });

    it('should allow seller to cancel listing and reclaim escrowed item', async () => {
      const seller = await createTestUser();
      const item = await createTestItem();

      await prisma.inventory.create({
        data: { userId: seller.id, itemId: item.id, quantity: 1 },
      });

      const sellerToken = generateTestToken(seller.id);

      // List item
      const listRes = await request(app)
        .post('/api/marketplace')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ itemId: item.id, priceCoins: 50 });
      expect(listRes.status).toBe(201);
      const listingId = listRes.body.id;

      // Cancel listing
      const cancelRes = await request(app)
        .delete(`/api/marketplace/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.success).toBe(true);

      // Verify item returned to seller inventory
      const sellerInv = await prisma.inventory.findUnique({
        where: { userId_itemId: { userId: seller.id, itemId: item.id } },
      });
      expect(sellerInv).not.toBeNull();
      expect(sellerInv?.quantity).toBe(1);
    });

    it('should reject purchase if buyer attempts to buy their own listing', async () => {
      const seller = await createTestUser({ havenCoins: 500 });
      const item = await createTestItem();

      await prisma.inventory.create({
        data: { userId: seller.id, itemId: item.id, quantity: 1 },
      });

      const sellerToken = generateTestToken(seller.id);

      const listRes = await request(app)
        .post('/api/marketplace')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ itemId: item.id, priceCoins: 50 });
      const listingId = listRes.body.id;

      const buyRes = await request(app)
        .post(`/api/marketplace/${listingId}/buy`)
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(buyRes.status).toBe(400);
      expect(buyRes.body.error).toMatch(/cannot purchase your own/i);
    });
  });

  describe('4.9: VIP Subscription / Club Haven', () => {
    it('should recognize VIP user privileges in database and user profiles', async () => {
      const vipUser = await createTestUser();
      await prisma.user.update({
        where: { id: vipUser.id },
        data: { isVIP: true, vipSince: new Date() },
      });

      const token = generateTestToken(vipUser.id);
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.isVIP).toBe(true);
    });
  });
});
