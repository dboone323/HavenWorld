export interface DialogueChoice {
  text: string;
  nextNodeId?: string;
  action?: string;
}

export interface DialogueNode {
  id: string;
  npcId: string;
  speaker: string;
  text: string;
  choices: DialogueChoice[];
}

export const NPC_DIALOGUES: Record<string, Record<string, DialogueNode>> = {
  mayor_baxter: {
    start: {
      id: 'start',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Greetings citizen! Welcome to HavenWorld. How can I assist you today?',
      choices: [
        { text: 'How do I decorate my personal Loft?', nextNodeId: 'loft_advice' },
        { text: 'How does the Haven economy work?', nextNodeId: 'economy_advice' },
        { text: 'Just passing through, thanks Mayor!', nextNodeId: 'goodbye' },
      ],
    },
    loft_advice: {
      id: 'loft_advice',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Every citizen receives their own personal Loft sanctuary! Press R to rotate furniture, and visit the Workshop to craft custom furnishings from raw materials.',
      choices: [
        { text: 'Tell me about the economy.', nextNodeId: 'economy_advice' },
        { text: 'Thank you for the advice, Mayor.', nextNodeId: 'goodbye' },
      ],
    },
    economy_advice: {
      id: 'economy_advice',
      npcId: 'mayor_baxter',
      speaker: 'Mayor Baxter',
      text: 'Earn HavenCoins through fishing at the fountain, baking pizzas at the pizzeria, or selling recycled components on the Player Marketplace.',
      choices: [
        { text: 'Where can I find more furniture?', nextNodeId: 'loft_advice' },
        { text: 'Sounds rewarding! See you around.', nextNodeId: 'goodbye' },
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
        { text: 'What is the secret to a perfect pizza score?', nextNodeId: 'pizza_secret' },
        { text: 'I am ready to work!', action: 'START_PIZZA_MINIGAME' },
      ],
    },
    pizza_secret: {
      id: 'pizza_secret',
      npcId: 'chef_luigi',
      speaker: 'Chef Luigi',
      text: 'Speed and precision! Chain 3 perfect pizzas in a row to activate a 1.5x coin combo multiplier!',
      choices: [
        { text: 'Understood, Chef! Let me into the kitchen.', action: 'START_PIZZA_MINIGAME' },
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
        { text: 'Any tips for catching legendary fish?', nextNodeId: 'fishing_tip' },
        { text: 'Good luck with the catch, Pete.', nextNodeId: 'goodbye' },
      ],
    },
    fishing_tip: {
      id: 'fishing_tip',
      npcId: 'fisherman_pete',
      speaker: 'Old Fisherman Pete',
      text: 'Keep your reel centered in the green zone. If the line tension turns red, ease off before it snaps!',
      choices: [
        { text: 'Thanks for the wisdom, Pete!', nextNodeId: 'goodbye' },
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
   * Selects a dialogue option and transitions to the subsequent node
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
}
