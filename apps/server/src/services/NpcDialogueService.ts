import { redis } from '../redis';

export type AffinityTier = 'STRANGER' | 'FRIENDLY' | 'HONORED' | 'REVERED';

export interface DialogueChoice {
  text: string;
  nextNodeId?: string;
  action?: string;
  requiredAffinity?: number;
  affinityDelta?: number;
  questHandoffId?: string;
  coinReward?: number;
}

export interface DialogueNode {
  id: string;
  npcId: string;
  speaker: string;
  text: string;
  choices: DialogueChoice[];
  minAffinityRequired?: number;
}

export const NPC_DIALOGUES: Record<string, Record<string, DialogueNode>> = {
  mayor_baxter: {
    start: {
      id: 'start',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Greetings citizen! Welcome to HavenWorld. How can I assist you today?',
      choices: [
        { text: 'How do I decorate my personal Loft?', nextNodeId: 'loft_advice', affinityDelta: 2 },
        { text: 'How does the Haven economy work?', nextNodeId: 'economy_advice', affinityDelta: 2 },
        { text: 'Do you have special assignments for an honored citizen?', nextNodeId: 'special_duty', requiredAffinity: 25 },
        { text: 'Just passing through, thanks Mayor!', nextNodeId: 'goodbye' },
      ],
    },
    loft_advice: {
      id: 'loft_advice',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Every citizen receives their own personal Loft sanctuary! Press R to rotate furniture, and visit the Workshop to craft custom furnishings from raw materials.',
      choices: [
        { text: 'Tell me about the economy.', nextNodeId: 'economy_advice', affinityDelta: 2 },
        { text: 'Thank you for the advice, Mayor.', nextNodeId: 'goodbye', affinityDelta: 1 },
      ],
    },
    economy_advice: {
      id: 'economy_advice',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Earn HavenCoins through fishing at the fountain, baking pizzas at the pizzeria, or selling recycled components on the Player Marketplace.',
      choices: [
        { text: 'Where can I find more furniture?', nextNodeId: 'loft_advice' },
        { text: 'Sounds rewarding! See you around.', nextNodeId: 'goodbye', affinityDelta: 1 },
      ],
    },
    special_duty: {
      id: 'special_duty',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Ah, a trusted citizen! The town council needs someone reliable to oversee our civic celebrations.',
      choices: [
        { text: 'I accept the civic duty!', nextNodeId: 'goodbye', affinityDelta: 10, questHandoffId: 'quest_civic_patrol', coinReward: 50 },
        { text: 'Perhaps later, Mayor.', nextNodeId: 'goodbye' },
      ],
    },
    goodbye: {
      id: 'goodbye',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Have a delightful day exploring the Plaza! Take care!',
      choices: [],
    },
  },
  chef_luigi: {
    start: {
      id: 'start',
      npcId: 'chef_luigi',
      speaker: 'Chef Luigi',
      text: 'Mamma mia! The kitchen is bustling! Are you ready to bake perfection?',
      choices: [
        { text: 'What is the secret to a perfect pizza score?', nextNodeId: 'pizza_secret', affinityDelta: 3 },
        { text: 'Do you need help with a master recipe?', nextNodeId: 'master_recipe', requiredAffinity: 30 },
        { text: 'I am ready to work!', action: 'START_PIZZA_MINIGAME' },
      ],
    },
    pizza_secret: {
      id: 'pizza_secret',
      npcId: 'chef_luigi',
      speaker: 'Chef Luigi',
      text: 'Speed and precision! Chain 3 perfect pizzas in a row to activate a 1.5x coin combo multiplier!',
      choices: [
        { text: 'Understood, Chef! Let me into the kitchen.', action: 'START_PIZZA_MINIGAME', affinityDelta: 2 },
      ],
    },
    master_recipe: {
      id: 'master_recipe',
      npcId: 'chef_luigi',
      speaker: 'Chef Luigi',
      text: 'You have proven your passion for cooking! Take this secret truffle recipe and make us proud!',
      choices: [
        { text: 'Grazie Chef!', nextNodeId: 'start', affinityDelta: 15, coinReward: 100 },
      ],
    },
  },
  fisherman_pete: {
    start: {
      id: 'start',
      npcId: 'fisherman_pete',
      speaker: 'Old Fisherman Pete',
      text: 'Ahoy there, matey. The fountain fish are bitin’ real good today.',
      choices: [
        { text: 'Any tips for catching legendary fish?', nextNodeId: 'fishing_tip', affinityDelta: 2 },
        { text: 'Show me your secret fishing spots.', nextNodeId: 'secret_waters', requiredAffinity: 20 },
        { text: 'Good luck with the catch, Pete.', nextNodeId: 'goodbye' },
      ],
    },
    fishing_tip: {
      id: 'fishing_tip',
      npcId: 'fisherman_pete',
      speaker: 'Old Fisherman Pete',
      text: 'Keep your reel centered in the green zone. If the line tension turns red, ease off before it snaps!',
      choices: [
        { text: 'Thanks for the wisdom, Pete!', nextNodeId: 'goodbye', affinityDelta: 1 },
      ],
    },
    secret_waters: {
      id: 'secret_waters',
      npcId: 'fisherman_pete',
      speaker: 'Old Fisherman Pete',
      text: 'Aye, under the glowing aurora or during dense fog, the deep abyss trench fish rise to the surface!',
      choices: [
        { text: 'I will watch the skies, Pete!', nextNodeId: 'goodbye', affinityDelta: 8 },
      ],
    },
    goodbye: {
      id: 'goodbye',
      npcId: 'fisherman_pete',
      speaker: 'Old Fisherman Pete',
      text: 'May the tides bring you fortune, adventurer.',
      choices: [],
    },
  },
};

export class NpcDialogueService {
  /**
   * Calculates affinity tier from score
   */
  static getAffinityTier(affinity: number): AffinityTier {
    if (affinity >= 100) return 'REVERED';
    if (affinity >= 50) return 'HONORED';
    if (affinity >= 20) return 'FRIENDLY';
    return 'STRANGER';
  }

  /**
   * Fetches player affinity with NPC from Redis
   */
  static async getAffinity(userId: string, npcId: string): Promise<{ affinity: number; tier: AffinityTier }> {
    const key = `npc:affinity:${userId}:${npcId}`;
    const raw = await redis.get(key);
    const affinity = raw ? parseInt(raw, 10) : 0;
    return {
      affinity,
      tier: this.getAffinityTier(affinity),
    };
  }

  /**
   * Adjusts player affinity with NPC in Redis
   */
  static async adjustAffinity(userId: string, npcId: string, delta: number): Promise<{ newAffinity: number; tier: AffinityTier }> {
    const key = `npc:affinity:${userId}:${npcId}`;
    const newAffinity = await redis.incrBy(key, delta);
    return {
      newAffinity,
      tier: this.getAffinityTier(newAffinity),
    };
  }

  /**
   * Retrieves dialogue node for an NPC
   */
  static getDialogue(npcId: string, nodeId: string = 'start'): DialogueNode {
    const npcTree = NPC_DIALOGUES[npcId];
    if (!npcTree) throw new Error(`NPC '${npcId}' does not have dialogue available`);

    const node = npcTree[nodeId];
    if (!node) throw new Error(`Dialogue node '${nodeId}' not found for NPC '${npcId}'`);

    return node;
  }

  /**
   * Evaluates which choices are accessible given player affinity
   */
  static async getAvailableChoices(userId: string, npcId: string, nodeId: string = 'start'): Promise<DialogueChoice[]> {
    const node = this.getDialogue(npcId, nodeId);
    const { affinity } = await this.getAffinity(userId, npcId);

    return node.choices.filter((choice) => {
      if (typeof choice.requiredAffinity === 'number' && affinity < choice.requiredAffinity) {
        return false;
      }
      return true;
    });
  }

  /**
   * Selects a dialogue option and transitions to the subsequent node (synchronous backward-compatible version)
   */
  static selectOption(npcId: string, currentNodeId: string, choiceIndex: number): {
    node: DialogueNode | null;
    action?: string;
  } {
    const currentNode = this.getDialogue(npcId, currentNodeId);
    const choice = currentNode.choices[choiceIndex];
    if (!choice) throw new Error(`Invalid choice index ${choiceIndex}`);

    if (choice.nextNodeId) {
      const nextNode = this.getDialogue(npcId, choice.nextNodeId);
      return { node: nextNode, action: choice.action };
    }

    return { node: null, action: choice.action };
  }

  /**
   * Interacts with choice, adjusting affinity, awarding coins, and advancing dialogue
   */
  static async interactWithAffinity(
    userId: string,
    npcId: string,
    currentNodeId: string,
    choiceIndex: number
  ): Promise<{
    node: DialogueNode | null;
    action?: string;
    affinityDelta?: number;
    currentAffinity: number;
    tier: AffinityTier;
    questHandoffId?: string;
    coinReward?: number;
  }> {
    const currentNode = this.getDialogue(npcId, currentNodeId);
    const choice = currentNode.choices[choiceIndex];
    if (!choice) throw new Error(`Invalid choice index ${choiceIndex}`);

    const { affinity } = await this.getAffinity(userId, npcId);
    if (typeof choice.requiredAffinity === 'number' && affinity < choice.requiredAffinity) {
      throw new Error(`Insufficient reputation standing to choose this dialogue option (requires ${choice.requiredAffinity}, current ${affinity})`);
    }

    let updatedAffinity = affinity;
    let tier = this.getAffinityTier(affinity);
    if (choice.affinityDelta) {
      const res = await this.adjustAffinity(userId, npcId, choice.affinityDelta);
      updatedAffinity = res.newAffinity;
      tier = res.tier;
    }

    const nextNode = choice.nextNodeId ? this.getDialogue(npcId, choice.nextNodeId) : null;
    return {
      node: nextNode,
      action: choice.action,
      affinityDelta: choice.affinityDelta,
      currentAffinity: updatedAffinity,
      tier,
      questHandoffId: choice.questHandoffId,
      coinReward: choice.coinReward,
    };
  }
}
