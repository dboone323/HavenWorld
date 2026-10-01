import {
  JukeboxPlaySchema,
  DiceRollSchema,
  HarvestSchema,
  ArcadeStartSchema,
  ArcadeMoveSchema,
  LoftStockSchema,
  LoftPurchaseSchema,
  ParcelSendSchema,
  NpcTalkSchema,
} from '../socketSchemas';

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('Phase 3B socket schemas: JukeboxPlaySchema', () => {
  it('accepts a well-formed play request', () => {
    expect(JukeboxPlaySchema.safeParse({ roomId: 'room-park', trackId: 'neon_pulse' }).success).toBe(true);
  });

  it('rejects an empty roomId and an oversized trackId', () => {
    expect(JukeboxPlaySchema.safeParse({ roomId: '', trackId: 'neon_pulse' }).success).toBe(false);
    expect(JukeboxPlaySchema.safeParse({ roomId: 'room-park', trackId: 'x'.repeat(65) }).success).toBe(false);
  });
});

describe('Phase 3B socket schemas: DiceRollSchema', () => {
  it('defaults to a d20 when no sides provided', () => {
    const parsed = DiceRollSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sides).toBe(20);
  });

  it('enforces the 2..100 integer range', () => {
    expect(DiceRollSchema.safeParse({ sides: 6 }).success).toBe(true);
    expect(DiceRollSchema.safeParse({ sides: 1 }).success).toBe(false);
    expect(DiceRollSchema.safeParse({ sides: 101 }).success).toBe(false);
    expect(DiceRollSchema.safeParse({ sides: 4.5 }).success).toBe(false);
  });
});

describe('Phase 3B socket schemas: HarvestSchema', () => {
  it('requires a non-empty, bounded nodeId', () => {
    expect(HarvestSchema.safeParse({ nodeId: 'node_oak_grove_1' }).success).toBe(true);
    expect(HarvestSchema.safeParse({ nodeId: '' }).success).toBe(false);
    expect(HarvestSchema.safeParse({ nodeId: 'x'.repeat(65) }).success).toBe(false);
  });
});

describe('Phase 3B socket schemas: Arcade schemas', () => {
  it('requires a UUID opponent id at start', () => {
    expect(ArcadeStartSchema.safeParse({ opponentId: VALID_UUID, cabinetId: 'cab-plaza-1' }).success).toBe(true);
    expect(ArcadeStartSchema.safeParse({ opponentId: 'not-a-uuid', cabinetId: 'cab-plaza-1' }).success).toBe(false);
  });

  it('clamps Connect-4 column picks to 0..6', () => {
    expect(ArcadeMoveSchema.safeParse({ matchId: 'c4_1', col: 0 }).success).toBe(true);
    expect(ArcadeMoveSchema.safeParse({ matchId: 'c4_1', col: 6 }).success).toBe(true);
    expect(ArcadeMoveSchema.safeParse({ matchId: 'c4_1', col: 7 }).success).toBe(false);
    expect(ArcadeMoveSchema.safeParse({ matchId: 'c4_1', col: -1 }).success).toBe(false);
  });
});

describe('Phase 3B socket schemas: Loft shop schemas', () => {
  it('stocks only whole positive coin prices on valid item IDs (UUID or slug)', () => {
    expect(LoftStockSchema.safeParse({ roomId: 'loft-1', itemId: VALID_UUID, priceCoins: 25 }).success).toBe(true);
    expect(LoftStockSchema.safeParse({ roomId: 'loft-1', itemId: 'item_chair_wood', priceCoins: 25 }).success).toBe(true);
    expect(LoftStockSchema.safeParse({ roomId: 'loft-1', itemId: VALID_UUID, priceCoins: 0 }).success).toBe(false);
    expect(LoftStockSchema.safeParse({ roomId: 'loft-1', itemId: VALID_UUID, priceCoins: 10.5 }).success).toBe(false);
    expect(LoftStockSchema.safeParse({ roomId: 'loft-1', itemId: '', priceCoins: 25 }).success).toBe(false);
  });

  it('purchases require a listing id', () => {
    expect(LoftPurchaseSchema.safeParse({ listingId: 'listing_42' }).success).toBe(true);
    expect(LoftPurchaseSchema.safeParse({ listingId: '' }).success).toBe(false);
  });
});

describe('Phase 3B socket schemas: ParcelSendSchema', () => {
  it('applies defaults for message and delay', () => {
    const parsed = ParcelSendSchema.safeParse({ recipientId: VALID_UUID, itemId: VALID_UUID });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message).toBe('');
      expect(parsed.data.delayMinutes).toBe(60);
    }
  });

  it('bounds the delivery delay between 1 minute and one week', () => {
    expect(ParcelSendSchema.safeParse({ recipientId: VALID_UUID, itemId: VALID_UUID, delayMinutes: 0 }).success).toBe(false);
    expect(ParcelSendSchema.safeParse({ recipientId: VALID_UUID, itemId: VALID_UUID, delayMinutes: 7 * 24 * 60 + 1 }).success).toBe(false);
    expect(ParcelSendSchema.safeParse({ recipientId: VALID_UUID, itemId: VALID_UUID, delayMinutes: 10080 }).success).toBe(true);
  });

  it('caps the parcel note at 200 characters', () => {
    expect(
      ParcelSendSchema.safeParse({ recipientId: VALID_UUID, itemId: VALID_UUID, message: 'x'.repeat(201) }).success
    ).toBe(false);
  });
});

describe('Phase 3B socket schemas: NpcTalkSchema', () => {
  it('defaults the conversation entry point to the start node', () => {
    const parsed = NpcTalkSchema.safeParse({ npcId: 'mayor_baxter' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.nodeId).toBe('start');
  });

  it('bounds dialogue choice indexes to 0..5', () => {
    expect(NpcTalkSchema.safeParse({ npcId: 'chef_luigi', nodeId: 'start', choiceIndex: 5 }).success).toBe(true);
    expect(NpcTalkSchema.safeParse({ npcId: 'chef_luigi', nodeId: 'start', choiceIndex: 6 }).success).toBe(false);
  });
});
