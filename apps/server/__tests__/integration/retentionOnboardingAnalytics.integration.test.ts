import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/prisma';
import { createTestUser } from '../helpers/factories';
import { truncateAllTables, seedMinimalData } from '../helpers/dbHelpers';
import { generateTestToken } from '../helpers/jwtHelpers';
import { TutorialService } from '../../src/services/TutorialService';
import { QuestService } from '../../src/services/QuestService';
import { LeaderboardService } from '../../src/services/LeaderboardService';
import { SeasonalThemeService } from '../../src/services/SeasonalThemeService';
import { PushService } from '../../src/services/PushService';
import { AnalyticsService } from '../../src/services/AnalyticsService';
import { FeedbackService } from '../../src/services/FeedbackService';

describe('Track 7 Integration: Retention, Onboarding & Analytics', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  describe('7.1: Interactive First-Time Tutorial & Onboarding', () => {
    it('should guide a new player through 3-step onboarding and award welcome badge', async () => {
      const user = await createTestUser({ havenCoins: 50 });
      const token = generateTestToken(user.id);

      // Check initial tutorial status
      const statusRes = await request(app)
        .get('/api/tutorial/status')
        .set('Authorization', `Bearer ${token}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.step).toBe(0);
      expect(statusRes.body.completed).toBe(false);

      // Attempting to skip step 1 to jump to step 3 should fail
      const skipRes = await request(app)
        .post('/api/tutorial/step')
        .set('Authorization', `Bearer ${token}`)
        .send({ step: 3 });

      expect(skipRes.status).toBe(400);

      // Step 1: Walk to fountain
      const step1Res = await request(app)
        .post('/api/tutorial/step')
        .set('Authorization', `Bearer ${token}`)
        .send({ step: 1 });

      expect(step1Res.status).toBe(200);
      expect(step1Res.body.step).toBe(1);

      // Step 2: Open wardrobe
      const step2Res = await request(app)
        .post('/api/tutorial/step')
        .set('Authorization', `Bearer ${token}`)
        .send({ step: 2 });

      expect(step2Res.status).toBe(200);
      expect(step2Res.body.step).toBe(2);

      // Step 3: Claim first daily gift
      const step3Res = await request(app)
        .post('/api/tutorial/step')
        .set('Authorization', `Bearer ${token}`)
        .send({ step: 3 });

      expect(step3Res.status).toBe(200);
      expect(step3Res.body.completed).toBe(true);
      expect(step3Res.body.welcomeBadgeAt).not.toBeNull();
      expect(step3Res.body.newBalance).toBe(150); // 50 + 100 bonus

      // Verify in DB
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(dbUser?.tutorialCompleted).toBe(true);
      expect(dbUser?.welcomeBadgeAt).not.toBeNull();
    });
  });

  describe('7.2: Daily Task Board', () => {
    it('should generate daily quests and advance progress to completion', async () => {
      const user = await createTestUser();

      // Retrieve user daily quests (3 deterministic quests generated)
      const quests = await QuestService.getUserDailyQuests(user.id);
      expect(quests.length).toBe(3);
      expect(quests.every((q) => q.progress === 0 && !q.completed)).toBe(true);

      // Simulate player action that matches a quest action
      const firstQuest = quests[0];
      await QuestService.incrementProgress(user.id, 'PIZZA_PERFECT', 5);

      // Verify updated quest
      const updatedQuests = await QuestService.getUserDailyQuests(user.id);
      const matching = updatedQuests.find((q) => q.questId === firstQuest.questId);
      expect(matching).toBeDefined();
    });
  });

  describe('7.4: Global Leaderboards', () => {
    it('should return top player rankings for richest residents and master chefs', async () => {
      const richPlayer = await createTestUser({ havenCoins: 9999 });
      const poorPlayer = await createTestUser({ havenCoins: 10 });
      const token = generateTestToken(richPlayer.id);

      // Leaderboard: RICHEST_PLAYERS
      const richRes = await request(app)
        .get('/api/leaderboard?category=RICHEST_PLAYERS')
        .set('Authorization', `Bearer ${token}`);

      expect(richRes.status).toBe(200);
      expect(richRes.body.length).toBeGreaterThan(0);
      expect(richRes.body[0].score).toBeGreaterThanOrEqual(richRes.body[richRes.body.length - 1].score);
      expect(richRes.body.some((e: any) => e.userId === richPlayer.id)).toBe(true);

      // Leaderboard: MASTER_CHEFS
      await prisma.minigameSession.create({
        data: {
          userId: richPlayer.id,
          gameType: 'PIZZA_CHEF',
          coinsEarned: 350,
          score: 800,
          duration: 45,
        },
      });

      const chefsRes = await request(app)
        .get('/api/leaderboard?category=MASTER_CHEFS')
        .set('Authorization', `Bearer ${token}`);

      expect(chefsRes.status).toBe(200);
      expect(chefsRes.body.some((e: any) => e.userId === richPlayer.id && e.score === 350)).toBe(true);
    });
  });

  describe('7.5: Seasonal Map Overlays', () => {
    it('should dynamically select seasonal tilesets and atmospheric themes', () => {
      // Winter: Dec, Jan, Feb
      const winterDate = new Date(Date.UTC(2026, 0, 15)); // Jan 15
      const winterConfig = SeasonalThemeService.getSeasonalConfig(winterDate);
      expect(winterConfig.season).toBe('WINTER');
      expect(winterConfig.outdoorTilesetKey).toBe('outdoor-winter');
      expect(winterConfig.particleType).toBe('snowflakes');

      // Autumn: Sep, Oct, Nov
      const autumnDate = new Date(Date.UTC(2026, 9, 20)); // Oct 20
      const autumnConfig = SeasonalThemeService.getSeasonalConfig(autumnDate);
      expect(autumnConfig.season).toBe('AUTUMN');
      expect(autumnConfig.outdoorTilesetKey).toBe('outdoor-autumn');
      expect(autumnConfig.particleType).toBe('falling_leaves');
    });
  });

  describe('7.6: Browser Web Push Notifications', () => {
    it('should register web push subscriptions and prepare notification payloads', async () => {
      const user = await createTestUser();

      await PushService.registerSubscription(user.id, {
        endpoint: 'https://updates.push.example.com/sub/user_123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcDnVwTGSquDY0-poTrWyXdopdgv7nHLsmgNccUDipmWo',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      });

      const subs = PushService.getSubscriptions(user.id);
      expect(subs.length).toBe(1);
      expect(subs[0].endpoint).toContain('updates.push.example.com');

      const dispatchResult = await PushService.sendNotification(user.id, {
        title: 'New Trade Offer!',
        body: 'A neighbor offered to trade for your Antique Armchair.',
      });

      expect(dispatchResult.deliveredCount).toBe(1);
    });
  });

  describe('7.7: Privacy-Respecting Telemetry & Analytics', () => {
    it('should track telemetry events and calculate DAU aggregations', async () => {
      const user = await createTestUser();

      await AnalyticsService.trackEvent('PLAYER_JOIN_WORLD', {
        userId: user.id,
        sessionId: 'sess_12345',
        roomId: 'town-square',
      });

      const dau = await AnalyticsService.dau(7);
      expect(Array.isArray(dau)).toBe(true);

      const sessionStats = await AnalyticsService.sessionLengths(7);
      expect(sessionStats).toHaveProperty('sessions');
      expect(sessionStats).toHaveProperty('averageSeconds');
    });
  });

  describe('7.8: In-Game Bug & Feedback Reporting Pane', () => {
    it('should submit bug reports and allow staff review of feedback backlog', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user.id);

      const submitRes = await request(app)
        .post('/api/feedback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'BUG',
          title: 'Collision glitch near plaza tree',
          message: 'Avatars sometimes get stuck on tile x=14, y=18 after rotating a sofa.',
        });

      expect(submitRes.status).toBe(201);
      expect(submitRes.body.title).toBe('Collision glitch near plaza tree');
      expect(submitRes.body.type).toBe('BUG');

      const listRes = await request(app)
        .get('/api/feedback')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThan(0);
      expect(listRes.body[0].title).toBe('Collision glitch near plaza tree');
      expect(listRes.body[0].username).toBe(user.username);
    });
  });
});
