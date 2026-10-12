import { NpcDialogueService } from '../NpcDialogueService';
import { redis, connectRedis, disconnectRedis } from '../../redis';

describe('Batch 42: Dynamic NPC Dialogue Trees & Reputation Standing', () => {
  const testUserId = `user_npc_test_${Date.now()}`;

  beforeAll(async () => {
    await connectRedis();
  });

  afterAll(async () => {
    await redis.del(`npc:affinity:${testUserId}:mayor_baxter`);
    await redis.del(`npc:affinity:${testUserId}:chef_luigi`);
    await disconnectRedis();
  });

  it('calculates affinity tiers accurately based on score thresholds', () => {
    expect(NpcDialogueService.getAffinityTier(0)).toBe('STRANGER');
    expect(NpcDialogueService.getAffinityTier(19)).toBe('STRANGER');
    expect(NpcDialogueService.getAffinityTier(20)).toBe('FRIENDLY');
    expect(NpcDialogueService.getAffinityTier(49)).toBe('FRIENDLY');
    expect(NpcDialogueService.getAffinityTier(50)).toBe('HONORED');
    expect(NpcDialogueService.getAffinityTier(99)).toBe('HONORED');
    expect(NpcDialogueService.getAffinityTier(100)).toBe('REVERED');
    expect(NpcDialogueService.getAffinityTier(250)).toBe('REVERED');
  });

  it('filters out choices requiring higher affinity when player is a stranger', async () => {
    const choices = await NpcDialogueService.getAvailableChoices(testUserId, 'mayor_baxter', 'start');
    const hasSpecialDuty = choices.some((c) => c.nextNodeId === 'special_duty');
    expect(hasSpecialDuty).toBe(false);
  });

  it('adjusts affinity and unlocks conditional choices when affinity threshold is reached', async () => {
    await NpcDialogueService.adjustAffinity(testUserId, 'mayor_baxter', 25);
    const { affinity, tier } = await NpcDialogueService.getAffinity(testUserId, 'mayor_baxter');
    expect(affinity).toBe(25);
    expect(tier).toBe('FRIENDLY');

    const unlockedChoices = await NpcDialogueService.getAvailableChoices(testUserId, 'mayor_baxter', 'start');
    const hasSpecialDuty = unlockedChoices.some((c) => c.nextNodeId === 'special_duty');
    expect(hasSpecialDuty).toBe(true);
  });

  it('successfully executes interactWithAffinity with rewards and handoffs', async () => {
    // Select special duty node
    const node = NpcDialogueService.getDialogue('mayor_baxter', 'special_duty');
    expect(node).toBeDefined();

    const result = await NpcDialogueService.interactWithAffinity(
      testUserId,
      'mayor_baxter',
      'special_duty',
      0
    );

    expect(result.affinityDelta).toBe(10);
    expect(result.questHandoffId).toBe('quest_civic_patrol');
    expect(result.coinReward).toBe(50);
    expect(result.currentAffinity).toBe(35);
  });

  it('maintains backwards compatibility with synchronous selectOption', () => {
    const res = NpcDialogueService.selectOption('mayor_baxter', 'start', 0);
    expect(res.node).toBeDefined();
    expect(res.node?.id).toBe('loft_advice');
  });
});
