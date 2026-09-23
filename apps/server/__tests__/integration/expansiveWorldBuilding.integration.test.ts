import { prisma } from '../../src/prisma';
import { createTestUser, createTestItem } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { TransitService } from '../../src/services/TransitService';
import { LoftRatingService } from '../../src/services/LoftRatingService';
import { JukeboxService } from '../../src/services/JukeboxService';
import { BulletinBoardService } from '../../src/services/BulletinBoardService';
import { LoftShopService } from '../../src/services/LoftShopService';
import { WeatherService } from '../../src/services/WeatherService';
import { SecretRoomService } from '../../src/services/SecretRoomService';
import { DelayedMailService } from '../../src/services/DelayedMailService';
import { EmoteProgressionService } from '../../src/services/EmoteProgressionService';
import { Web3CollectibleService } from '../../src/services/Web3CollectibleService';
import crypto from 'crypto';

describe('Track 9 Integration: Expansive World Building', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
    TransitService.resetForTesting();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('9.2: Scheduled Public Transit (The Haven Subway / Tram)', () => {
    it('should cycle tram through transit states and carry boarded passengers', () => {
      const p1 = 'user_rider_1';
      const p2 = 'user_rider_2';

      // Board tram
      const boardRes = TransitService.boardTram(p1, 'Plaza Central Station');
      expect(boardRes.success).toBe(true);
      expect(boardRes.passengerCount).toBe(1);

      TransitService.boardTram(p2, 'Plaza Central Station');
      expect(TransitService.getStatus().passengers).toContain(p1);
      expect(TransitService.getStatus().passengers).toContain(p2);

      // Advance: BOARDING -> DEPARTING
      const s1 = TransitService.advanceState();
      expect(s1.state).toBe('DEPARTING');

      // Attempting to board while departing throws
      expect(() => TransitService.boardTram('late_rider', 'Plaza Central Station')).toThrow(/closed/i);

      // Advance: DEPARTING -> IN_TRANSIT
      const s2 = TransitService.advanceState();
      expect(s2.state).toBe('IN_TRANSIT');

      // Advance: IN_TRANSIT -> ARRIVED (Swaps station to Sanctuary Isles)
      const s3 = TransitService.advanceState();
      expect(s3.state).toBe('ARRIVED');
      expect(s3.currentStation).toBe('Sanctuary Isles');

      // Advance: ARRIVED -> BOARDING (ready for return trip)
      const s4 = TransitService.advanceState();
      expect(s4.state).toBe('BOARDING');
    });
  });

  describe('9.3: Dynamic Room Rating & Discovery', () => {
    it('should allow visitors to upvote a loft with strict deduplication', async () => {
      const owner = await createTestUser();
      const visitor = await createTestUser();

      const room = await prisma.room.create({
        data: {
          name: 'Cozy Botanical Sanctuary',
          ownerId: owner.id,
          isPublic: true,
          theme: 'botanical',
          backgroundKey: 'map-personal-room',
        },
      });

      // Owner cannot upvote their own room
      await expect(LoftRatingService.upvoteRoom(owner.id, room.id)).rejects.toThrow(/own room/i);

      // Visitor upvotes
      const upvote = await LoftRatingService.upvoteRoom(visitor.id, room.id);
      expect(upvote.hasUpvoted).toBe(true);
      expect(upvote.totalUpvotes).toBe(1);

      // Duplicate upvote fails
      await expect(LoftRatingService.upvoteRoom(visitor.id, room.id)).rejects.toThrow(/already upvoted/i);

      // Check trending
      const trending = await LoftRatingService.getTrendingLofts();
      expect(trending.some((t) => t.roomId === room.id)).toBe(true);
    });
  });

  describe('9.4: Jukeboxes & Synchronized Chiptune Tracks', () => {
    it('should set synchronized room tracks and calculate current playback offset', () => {
      const roomId = 'room_party_lounge';

      const state = JukeboxService.playTrack(roomId, 'haven_nostalgia');
      expect(state.trackId).toBe('haven_nostalgia');
      expect(state.durationSeconds).toBe(96);

      const current = JukeboxService.getCurrentTrack(roomId);
      expect(current.track?.title).toBe('Haven Nostalgia');
      expect(current.offsetSeconds).toBeGreaterThanOrEqual(0);
      expect(current.offsetSeconds).toBeLessThan(96);
    });
  });

  describe('9.5: Public Bulletin Message Boards', () => {
    it('should post notices to the Plaza bulletin corkboard and filter by category', async () => {
      const user = await createTestUser();

      const post1 = await BulletinBoardService.postMessage(user.id, {
        category: 'TRADE',
        title: 'Trading Rare Steampunk Sofa',
        body: 'Looking for neon prismatic lamps or 500 HavenCoins. Whisper me!',
      });
      expect(post1.category).toBe('TRADE');
      expect(post1.expiresAt).toBeGreaterThan(Date.now());

      const post2 = await BulletinBoardService.postMessage(user.id, {
        category: 'GUILD',
        title: 'Haven Knights are Recruiting',
        body: 'Active friendly community seeking daily decorators.',
      });

      const tradePosts = BulletinBoardService.getActivePosts('TRADE');
      expect(tradePosts.length).toBeGreaterThanOrEqual(1);
      expect(tradePosts[0].title).toBe('Trading Rare Steampunk Sofa');

      const allPosts = BulletinBoardService.getActivePosts();
      expect(allPosts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('9.6: Player-Run Loft Shops', () => {
    it('should allow owner to stock cash register and guest to complete atomic purchase', async () => {
      const owner = await createTestUser({ havenCoins: 100 });
      const buyer = await createTestUser({ havenCoins: 500 });
      const item = await createTestItem({ price: 150 });

      const room = await prisma.room.create({
        data: {
          name: 'Owner Antique Boutique',
          ownerId: owner.id,
          isPublic: true,
          theme: 'boutique',
          backgroundKey: 'map-personal-room',
        },
      });

      // Give item to owner
      await prisma.inventory.create({
        data: { userId: owner.id, itemId: item.id, quantity: 1 },
      });

      // Owner stocks register at 200 HavenCoins
      const listing = await LoftShopService.stockRegister(owner.id, room.id, item.id, 200);
      expect(listing.priceCoins).toBe(200);

      // Buyer purchases from register
      const purchase = await LoftShopService.purchaseFromRegister(buyer.id, listing.id);
      expect(purchase.success).toBe(true);

      // Verify buyer coin deduction (500 - 200 = 300)
      const dbBuyer = await prisma.user.findUnique({ where: { id: buyer.id } });
      expect(dbBuyer?.havenCoins).toBe(300);

      // Verify seller coin increment (100 + 200 = 300)
      const dbOwner = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(dbOwner?.havenCoins).toBe(300);

      // Verify buyer received item
      const buyerInv = await prisma.inventory.findFirst({
        where: { userId: buyer.id, itemId: item.id },
      });
      expect(buyerInv?.quantity).toBe(1);

      // Listing cannot be bought twice
      await expect(LoftShopService.purchaseFromRegister(buyer.id, listing.id)).rejects.toThrow(
        /no longer available/i
      );
    });
  });

  describe('9.7: Global Dynamic Weather Systems', () => {
    it('should cycle global weather conditions', () => {
      const rain = WeatherService.setWeather('RAIN', 0.8);
      expect(rain.currentWeather).toBe('RAIN');
      expect(rain.intensity).toBe(0.8);

      const snow = WeatherService.setWeather('SNOW', 0.6);
      expect(snow.currentWeather).toBe('SNOW');
      expect(WeatherService.getWeather().currentWeather).toBe('SNOW');
    });
  });

  describe('9.8: Secret Rooms & Easter Eggs', () => {
    it('should detect secret chat trigger phrases and unlock hidden observatory', async () => {
      const user = await createTestUser();

      // Normal chat does not trigger secret
      const normalRes = await SecretRoomService.checkSecretTrigger(user.id, 'plaza', 'Hello everyone!');
      expect(normalRes.triggered).toBe(false);

      // Speaking magic password triggers secret chamber
      const secretRes = await SecretRoomService.checkSecretTrigger(
        user.id,
        'plaza',
        'Whispering the ancient phrase: abracadabra!'
      );
      expect(secretRes.triggered).toBe(true);
      expect(secretRes.secretRoomId).toBe('room_secret_observatory');
      expect(secretRes.easterEggName).toBe('The Forgotten Observatory');
    });
  });

  describe('9.9: In-Game Post Office & Delayed Delivery', () => {
    it('should schedule parcels and deliver them upon arrival timestamp', async () => {
      const sender = await createTestUser();
      const recipient = await createTestUser();
      const item = await createTestItem({ price: 75 });

      // Send parcel with 30 min delay
      const parcel = await DelayedMailService.sendDelayedParcel(
        sender.id,
        recipient.id,
        item.id,
        'A mysterious package from afar...',
        30
      );
      expect(parcel.delivered).toBe(false);

      // Immediate check should deliver nothing (still in transit)
      const immediateArrivals = await DelayedMailService.processArrivedMail(Date.now());
      expect(immediateArrivals.length).toBe(0);

      // Fast forward past arrival time (35 minutes later)
      const futureNow = Date.now() + 35 * 60_000;
      const arrivals = await DelayedMailService.processArrivedMail(futureNow);
      expect(arrivals.length).toBe(1);
      expect(arrivals[0].id).toBe(parcel.id);

      // Verify recipient received parcel in inventory
      const recipientInv = await prisma.inventory.findFirst({
        where: { userId: recipient.id, itemId: item.id },
      });
      expect(recipientInv?.quantity).toBe(1);
    });
  });

  describe('9.10: Emote Unlock Trees', () => {
    it('should evaluate progression gates for base and advanced avatar emotes', async () => {
      const user = await createTestUser({ havenCoins: 50 });

      // Base user has base emotes unlocked
      const emotes = await EmoteProgressionService.getPlayerEmotes(user.id);
      expect(emotes.find((e) => e.id === 'wave')?.unlocked).toBe(true);
      expect(emotes.find((e) => e.id === 'dance')?.unlocked).toBe(true);

      // Advanced emotes locked
      expect(emotes.find((e) => e.id === 'backflip')?.unlocked).toBe(false);

      // Catch 5 fish
      for (let i = 0; i < 5; i++) {
        await prisma.fishCatch.create({
          data: {
            userId: user.id,
            species: 'Neon Guppy',
            weightLbs: 0.8,
            coinsEarned: 15,
          },
        });
      }

      // Backflip is now unlocked!
      const updatedEmotes = await EmoteProgressionService.getPlayerEmotes(user.id);
      expect(updatedEmotes.find((e) => e.id === 'backflip')?.unlocked).toBe(true);
    });
  });

  describe('9.11: Optional Web3 / Digital Collectibles (Zero-Cost Read-Only)', () => {
    it('should generate verification challenges and verify cryptographic signatures', () => {
      const user = 'usr_test_crypto_123';
      const challenge = Web3CollectibleService.generateChallenge(user);
      expect(challenge.challenge).toContain(user);

      // Generate a test keypair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      // Sign challenge
      const sign = crypto.createSign('SHA256');
      sign.update(challenge.challenge);
      sign.end();
      const signature = sign.sign(privateKey, 'base64');

      // Verify with public key
      const isValid = Web3CollectibleService.verifyOwnershipSignature(
        publicKey,
        challenge.challenge,
        signature
      );
      expect(isValid).toBe(true);

      // Tampered message fails
      const isTamperedValid = Web3CollectibleService.verifyOwnershipSignature(
        publicKey,
        'Tampered challenge text',
        signature
      );
      expect(isTamperedValid).toBe(false);
    });
  });
});
