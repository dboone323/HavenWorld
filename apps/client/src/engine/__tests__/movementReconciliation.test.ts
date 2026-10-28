import { describe, it, expect, beforeEach } from 'vitest';
import { MovementReconciliation } from '../MovementReconciliation';

describe('MovementReconciliation (Client Netcode & Smoothing)', () => {
  let recon: MovementReconciliation;

  beforeEach(() => {
    recon = new MovementReconciliation({ x: 0, y: 0 }, 0.5);
  });

  it('snaps directly to simulated replay position when smoothingFactor is omitted', () => {
    // Add client-side predicted move
    recon.addPredictedMove(5, 5);
    expect(recon.currentPosition).toEqual({ x: 5, y: 5 });
    expect(recon.getPendingMoveCount()).toBe(1);

    // Server acknowledges move with authority at (10, 10)
    // Drift is hypot(5 - 10, 5 - 10) = ~7.07 > epsilon (0.5)
    const result = recon.reconcile(1, { x: 10, y: 10 });

    expect(result.reconciled).toBe(true);
    expect(result.correctedPosition).toEqual({ x: 10, y: 10 });
    // In default snap mode without smoothing factor, currentPosition snaps instantly
    expect(recon.currentPosition).toEqual({ x: 10, y: 10 });
    expect(recon.getPendingMoveCount()).toBe(0);
  });

  it('interpolates smoothly towards simulated position when smoothingFactor is provided', () => {
    // Initial position is (0, 0)
    // Server reports authoritative position at (10, 10) with sequence 0
    // Drift = hypot(0 - 10, 0 - 10) = ~14.14 > 0.5
    const smoothingFactor = 0.25;
    const step1 = recon.reconcile(0, { x: 10, y: 10 }, smoothingFactor);

    expect(step1.reconciled).toBe(true);
    // Interpolated calculation: 0 + (10 - 0) * 0.25 = 2.5
    expect(step1.correctedPosition.x).toBeCloseTo(2.5, 4);
    expect(step1.correctedPosition.y).toBeCloseTo(2.5, 4);
    expect(recon.currentPosition.x).toBeCloseTo(2.5, 4);
    expect(recon.currentPosition.y).toBeCloseTo(2.5, 4);

    // Next frame smoothing iteration
    // Current is (2.5, 2.5). Target is (10, 10). Delta is 7.5.
    // 2.5 + 7.5 * 0.25 = 4.375
    const step2 = recon.reconcile(0, { x: 10, y: 10 }, smoothingFactor);
    expect(step2.reconciled).toBe(true);
    expect(step2.correctedPosition.x).toBeCloseTo(4.375, 4);
    expect(step2.correctedPosition.y).toBeCloseTo(4.375, 4);
  });

  it('does not adjust position when drift is within driftEpsilon threshold', () => {
    recon.currentPosition = { x: 5.1, y: 5.2 };

    // Server reports position at (5.0, 5.0).
    // Drift = hypot(5.1 - 5.0, 5.2 - 5.0) = hypot(0.1, 0.2) ≈ 0.2236 < 0.5
    const result = recon.reconcile(0, { x: 5.0, y: 5.0 }, 0.25);

    expect(result.reconciled).toBe(false);
    expect(result.correctedPosition).toEqual({ x: 5.1, y: 5.2 });
    expect(recon.currentPosition).toEqual({ x: 5.1, y: 5.2 });
  });

  it('replays pending unacknowledged inputs on top of authoritative server position', () => {
    // Client queues move 1 to (2, 2) and move 2 to (6, 6)
    recon.addPredictedMove(2, 2);
    recon.addPredictedMove(6, 6);
    expect(recon.getPendingMoveCount()).toBe(2);

    // Server only acknowledged move 1 at position (2, 2)
    // Server state (2, 2) + pending move 2 target (6, 6) = simulated (6, 6)
    const result = recon.reconcile(1, { x: 2, y: 2 });

    expect(result.reconciled).toBe(false); // drift between current (6, 6) and simulated (6, 6) is 0
    expect(recon.getPendingMoveCount()).toBe(1); // move 1 discarded, move 2 retained
  });

  it('corrects accumulated drift on waypoint arrival reconciliation', () => {
    // Local avatar moved across waypoints to target (12, 14)
    recon.addPredictedMove(6, 7);
    recon.addPredictedMove(12, 14);
    expect(recon.currentPosition).toEqual({ x: 12, y: 14 });

    // Server acknowledged both moves but authoritative position ended at (12.8, 14.6)
    // Drift = hypot(12 - 12.8, 14 - 14.6) = 1.0 > 0.5
    const result = recon.reconcile(2, { x: 12.8, y: 14.6 }, 0.25);

    expect(result.reconciled).toBe(true);
    // Exponential smoothing pulls toward server position:
    // 12 + (12.8 - 12) * 0.25 = 12.2
    // 14 + (14.6 - 14) * 0.25 = 14.15
    expect(result.correctedPosition.x).toBeCloseTo(12.2, 4);
    expect(result.correctedPosition.y).toBeCloseTo(14.15, 4);
    expect(recon.getPendingMoveCount()).toBe(0);
  });
});
