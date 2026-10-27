import { MovementValidator, type Position3D } from '../movement';

describe('MovementValidator Authoritative Server Movement & Canonical Spawn', () => {
  const playerId = 'test-player-movement-1';

  beforeEach(() => {
    MovementValidator.removePlayer(playerId);
  });

  afterEach(() => {
    MovementValidator.removePlayer(playerId);
  });

  it('rejects uninitialized player state and resets to canonical room spawn', () => {
    const arbitraryClientPos: Position3D = { x: 50, y: 80, z: 25 };
    const canonicalParkSpawn: Position3D = { x: 0, y: 0, z: 3.5 };

    // Validate without initializing player first
    const result = MovementValidator.validateMovement(playerId, arbitraryClientPos, canonicalParkSpawn);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('UNINITIALIZED_STATE_RESET_TO_CANONICAL_SPAWN');
    expect(result.violations).toBe(1);
    expect(result.correctedPosition).toEqual({ x: 0, y: 0, z: 3.5 });

    // Player state must now be initialized at the canonical spawn point
    expect(MovementValidator.getViolations(playerId)).toBe(1);

    // Subsequent normal movement near the canonical spawn should now be validated relative to spawn
    const nextStep: Position3D = { x: 0.5, y: 0.2, z: 3.5 };
    const followUpResult = MovementValidator.validateMovement(playerId, nextStep, canonicalParkSpawn);

    expect(followUpResult.valid).toBe(true);
    expect(followUpResult.correctedPosition).toEqual(nextStep);
  });

  it('defaults to { x: 0, y: 0, z: 0 } when canonical spawn is omitted for uninitialized state', () => {
    const arbitraryClientPos: Position3D = { x: -45, y: 120, z: 10 };
    const result = MovementValidator.validateMovement('uninitialized-default-player', arbitraryClientPos);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('UNINITIALIZED_STATE_RESET_TO_CANONICAL_SPAWN');
    expect(result.correctedPosition).toEqual({ x: 0, y: 0, z: 0 });

    MovementValidator.removePlayer('uninitialized-default-player');
  });

  it('validates legitimate movement within the speed and tolerance limits', () => {
    MovementValidator.initializePlayer(playerId, { x: 10, y: 10, z: 0 });

    const step: Position3D = { x: 10.8, y: 10.5, z: 0 };
    const result = MovementValidator.validateMovement(playerId, step);

    expect(result.valid).toBe(true);
    expect(result.correctedPosition).toEqual(step);
    expect(result.violations).toBe(0);
  });

  it('detects speed hacking / teleportation deviations and increments violations', () => {
    MovementValidator.initializePlayer(playerId, { x: 0, y: 0, z: 0 });

    // Attempt extreme jump of 150 units in single frame
    const teleportPos: Position3D = { x: 150, y: 150, z: 0 };
    const result = MovementValidator.validateMovement(playerId, teleportPos);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('SPEED_LIMIT_EXCEEDED');
    expect(result.violations).toBe(1);
    // Corrected position remains the last valid position
    expect(result.correctedPosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(MovementValidator.getViolations(playerId)).toBe(1);
  });
});
