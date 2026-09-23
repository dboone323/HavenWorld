import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';
import { MinigameService } from '../../src/services/MinigameService';
import { ArcadeService } from '../../src/services/ArcadeService';
import { GatheringService } from '../../src/services/GatheringService';
import { WorkshopService } from '../../src/services/WorkshopService';
import { NpcDialogueService } from '../../src/services/NpcDialogueService';
import { ScavengerHuntService } from '../../src/services/ScavengerHuntService';
import { RandomizerService } from '../../src/services/RandomizerService';
import { GlobalEventService } from '../../src/services/GlobalEventService';

describe('Track 6 Integration: Mini-Games, Professions & Interactivity', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('6.2: Global Job Cooldowns & Anti-Bot Limits', () => {
    it('should enforce the rolling 60-minute earnings cap (500 coins/hr)', async () => {
      const user = await createTestUser();

      // Seed minigame sessions totaling 500 coins earned 10 minutes ago
      await prisma.minigameSession.create({
        data: {
          userId: user.id,
          gameType: 'PIZZA_CHEF',
          coinsEarned: 500,
          score: 100,
          duration: 30,
          completedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      // Next order exceeding 500 cap must be rejected
      await expect(
        MinigameService.submitPizzaOrder(user.id, {
          recipe: 'margherita',
          ingredients: ['dough', 'sauce', 'mozzarella'],
          durationMs: 10000,
        })
      ).rejects.toThrow(/HOURLY_LIMIT_EXCEEDED/);

      // Verify that sessions older than 60 minutes do not block earnings
      const user2 = await createTestUser();
      await prisma.minigameSession.create({
        data: {
          userId: user2.id,
          gameType: 'PIZZA_CHEF',
          coinsEarned: 500,
          score: 100,
          duration: 30,
          completedAt: new Date(Date.now() - 70 * 60 * 1000), // 70 minutes ago
        },
      });

      const orderResult = await MinigameService.submitPizzaOrder(user2.id, {
        recipe: 'margherita',
        ingredients: ['dough', 'sauce', 'mozzarella'],
        durationMs: 10000,
      });
      expect(orderResult.coinsEarned).toBeGreaterThan(0);
    });
  });

  describe('6.3: 2-Player Plaza Arcade Cabinets (Connect-4)', () => {
    it('should run a synchronized 2-player Connect-4 match to a win condition', async () => {
      const player1 = await createTestUser();
      const player2 = await createTestUser();

      const match = ArcadeService.startMatch(player1.id, player2.id, 'cabinet-plaza-north');
      expect(match.status).toBe('IN_PROGRESS');
      expect(match.currentTurn).toBe(player1.id);

      // P1 drops col 0, P2 drops col 1, repeated until P1 has 4 vertical pieces in col 0
      ArcadeService.makeMove(match.id, player1.id, 0); // P1 at row 5, col 0
      ArcadeService.makeMove(match.id, player2.id, 1); // P2 at row 5, col 1

      ArcadeService.makeMove(match.id, player1.id, 0); // P1 at row 4, col 0
      ArcadeService.makeMove(match.id, player2.id, 1); // P2 at row 4, col 1

      ArcadeService.makeMove(match.id, player1.id, 0); // P1 at row 3, col 0
      ArcadeService.makeMove(match.id, player2.id, 1); // P2 at row 3, col 1

      // P1 4th piece in col 0 wins!
      const wonMatch = ArcadeService.makeMove(match.id, player1.id, 0); // P1 at row 2, col 0

      expect(wonMatch.status).toBe('FINISHED');
      expect(wonMatch.winnerId).toBe(player1.id);
      expect(wonMatch.isDraw).toBe(false);

      // Attempting move after match end throws
      expect(() => ArcadeService.makeMove(match.id, player2.id, 1)).toThrow(/Match has already finished/);
    });
  });

  describe('6.4: Resource Gathering Nodes', () => {
    it('should harvest raw materials and enforce cooldowns', async () => {
      const user = await createTestUser();

      const result = await GatheringService.harvestNode(user.id, 'plaza_apple_tree');
      expect(result.material).toBe('timber');
      expect(result.quantity).toBe(2);
      expect(result.inventory.timber).toBe(2);

      // Immediate second harvest must fail due to cooldown
      await expect(GatheringService.harvestNode(user.id, 'plaza_apple_tree')).rejects.toThrow(/cooldown/i);

      // But harvesting a different node works
      const herbResult = await GatheringService.harvestNode(user.id, 'garden_herb_patch');
      expect(herbResult.material).toBe('fabric');
      expect(herbResult.inventory.fabric).toBe(2);
    });
  });

  describe('6.5: The Crafting Workbench', () => {
    it('should craft an item using raw materials and place it in inventory', async () => {
      const user = await createTestUser();

      // Seed user with raw materials
      await prisma.materialInventory.upsert({
        where: { userId: user.id },
        create: { userId: user.id, timber: 20, fabric: 10, scrapMetal: 10, crystalShard: 5 },
        update: { timber: 20, fabric: 10, scrapMetal: 10, crystalShard: 5 },
      });

      // Start crafting 'recipe_reclaimed_bookshelf' (costs 10 timber, 2 fabric)
      const queueItem = await WorkshopService.startCraft(user.id, 'recipe_reclaimed_bookshelf');
      expect(queueItem.recipeId).toBe('recipe_reclaimed_bookshelf');

      // Fast forward queue completion
      await prisma.craftingQueue.update({
        where: { id: queueItem.id },
        data: { completesAt: new Date(Date.now() - 1000) },
      });

      // Claim craft
      const craftedItem = await WorkshopService.claimCraft(user.id, queueItem.id);
      expect(craftedItem.id).toBe('furniture-bookshelf');

      // Verify in inventory
      const inv = await prisma.inventory.findFirst({
        where: { userId: user.id, itemId: craftedItem.id },
      });
      expect(inv).not.toBeNull();
      expect(inv!.quantity).toBe(1);
    });
  });

  describe('6.6: Persistent NPC Dialogue Trees', () => {
    it('should traverse branching dialogue trees for Mayor Baxter and Chef Luigi', () => {
      const mayorGreeting = NpcDialogueService.getDialogue('mayor_baxter', 'start');
      expect(mayorGreeting.speaker).toBe('Mayor Baxter');
      expect(mayorGreeting.choices.length).toBeGreaterThan(0);

      // Select first option: 'How do I decorate my personal Loft?'
      const next = NpcDialogueService.selectOption('mayor_baxter', 'start', 0);
      expect(next.node?.id).toBe('loft_advice');
      expect(next.node?.text).toContain('personal Loft sanctuary');

      // Chef Luigi
      const chefGreeting = NpcDialogueService.getDialogue('chef_luigi', 'start');
      expect(chefGreeting.speaker).toBe('Chef Luigi');
      const chefOption = NpcDialogueService.selectOption('chef_luigi', 'start', 0);
      expect(chefOption.node?.id).toBe('pizza_secret');
      expect(chefOption.node?.text).toContain('1.5x coin combo');
    });
  });

  describe('6.7: Dynamic Scavenger Hunts (Golden Ticket)', () => {
    it('should spawn ticket, validate coordinate proximity, and award coins', async () => {
      const user = await createTestUser();
      const initialCoins = user.havenCoins;

      const ticket = ScavengerHuntService.spawnTicket('town-square', 10, 10, 150);
      expect(ticket.rewardCoins).toBe(150);

      // Attempt claim from too far away (dist > 2.5)
      await expect(ScavengerHuntService.claimTicket(ticket.id, user.id, 20, 20)).rejects.toThrow(
        /Too far away/i
      );

      // Claim from close proximity (x=10, y=11)
      const claimResult = await ScavengerHuntService.claimTicket(ticket.id, user.id, 10, 11);
      expect(claimResult.rewardCoins).toBe(150);
      expect(claimResult.userNewBalance).toBe(initialCoins + 150);

      // Second claim attempt must fail
      await expect(ScavengerHuntService.claimTicket(ticket.id, user.id, 10, 10)).rejects.toThrow(
        /already been claimed/i
      );
    });
  });

  describe('6.8: Verifiable Dice & Randomizers', () => {
    it('should produce cryptographically bounded dice rolls within specified sides', async () => {
      const user = await createTestUser();

      const roll20 = await RandomizerService.rollDice(user.id, 'room_plaza', 20);
      expect(roll20.sides).toBe(20);
      expect(roll20.result).toBeGreaterThanOrEqual(1);
      expect(roll20.result).toBeLessThanOrEqual(20);
      expect(roll20.formattedMessage).toMatch(/rolled a \d+ \(1-20\)/);

      const roll6 = await RandomizerService.rollDice(user.id, 'room_plaza', 6);
      expect(roll6.sides).toBe(6);
      expect(roll6.result).toBeGreaterThanOrEqual(1);
      expect(roll6.result).toBeLessThanOrEqual(6);
    });
  });

  describe('6.9: Synchronized Global Events', () => {
    it('should trigger and maintain active server-wide event with multipliers', () => {
      const event = GlobalEventService.triggerGlobalEvent(
        'DOUBLE_COINS',
        'Double Coins Fiesta!',
        'All coin earnings doubled for the next hour',
        60,
        2.0
      );

      expect(event.type).toBe('DOUBLE_COINS');
      expect(event.multiplier).toBe(2.0);

      const currentMultiplier = GlobalEventService.getCurrentCoinMultiplier();
      expect(currentMultiplier).toBe(2.0);

      const active = GlobalEventService.getActiveEvent();
      expect(active?.title).toBe('Double Coins Fiesta!');
    });
  });

  describe('6.10: In-Game Photo Mode & Camera Gallery', () => {
    it('should upload a photo and fetch it via /api/gallery', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user.id);

      const uploadRes = await request(app)
        .post('/api/gallery')
        .set('Authorization', `Bearer ${token}`)
        .send({
          imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          caption: 'My cozy isometric loft sanctuary',
          roomName: 'My Loft',
        });

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.caption).toBe('My cozy isometric loft sanctuary');

      const feedRes = await request(app)
        .get('/api/gallery')
        .set('Authorization', `Bearer ${token}`);

      expect(feedRes.status).toBe(200);
      expect(feedRes.body.length).toBeGreaterThan(0);
      expect(feedRes.body[0].caption).toBe('My cozy isometric loft sanctuary');
      expect(feedRes.body[0].authorName).toBe(user.username);
    });
  });
});
